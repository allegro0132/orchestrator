"""Convert the pinned SkyTNT ONNX graphs to INT4 constant MatMuls + FP16 activations."""
import argparse
import collections
import hashlib
import json
import logging
import warnings
import os
import pathlib
import time


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('model_dir', type=pathlib.Path)
    parser.add_argument('output_dir', type=pathlib.Path)
    parser.add_argument('--bits', type=int, choices=[4, 16], default=4)
    parser.add_argument('--pure-half', action='store_true')
    args = parser.parse_args()
    source, output = args.model_dir.resolve(), args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    os.chdir(output)
    # Optional native-runtime diagnostics stay beside temporary model files.
    import numpy as np
    import onnx
    import onnxruntime
    from onnxconverter_common import float16
    from onnxruntime.quantization.matmul_nbits_quantizer import (
        DefaultWeightOnlyQuantConfig, MatMulNBitsQuantizer,
    )
    from onnxruntime.quantization.quant_utils import QuantFormat
    logging.getLogger().setLevel(logging.WARNING)
    warnings.filterwarnings('ignore', message='the float32 number.*', module='onnxconverter_common.float16')
    hashes = {
        'base': '1af68e16a0509936caeb70d322ab30619d784c7af72df019f3a59276c67c1bc4',
        'token': 'cce9376abe8f5c8d51d1b110580cc8501d38679af55ebd5a332e757e62ab9911',
    }
    report = dict(
        id=f'skytnt-tv2o-medium-w{args.bits}a16-' + ('pure-v1' if args.pure_half else 'stable-v2'),
        sourceRevision='0f8f265d4330f4e46527ac2313200254c5757f5f',
        recipe=dict(weightBits=args.bits, activationType='float16', kvType='float16',
                    algorithm='RTN' if args.bits == 4 else 'none', blockSize=32 if args.bits == 4 else None, symmetric=args.bits == 4,
                    quantizedOps=['constant-input MatMul'] if args.bits == 4 else [],
                    unquantizedWeights='FP16 embeddings; ' + ('FP16' if args.pure_half else 'FP32') + ' normalization weights',
                    accuracyLevel=0, lastOutputOnly=True,
                    fp32Islands=[] if args.pure_half else ['RMSNorm', 'RoPE', 'Softmax']),
        tools=dict(onnx=onnx.__version__, onnxruntime=onnxruntime.__version__), files={},
    )
    for part, expected in hashes.items():
        path = source / f'model_{part}.onnx'
        if digest(path) != expected:
            raise ValueError(f'Incorrect pinned {part} source weights')
        started = time.perf_counter()
        model = onnx.load(path)
        # Preserve the original exported operators/opset and dynamic cache shapes.
        blocked = [] if args.pure_half else [n.name for n in model.graph.node
                    if 'norm/' in n.name or '/rotary_emb/' in n.name or n.op_type == 'Softmax']
        original_casts = {n.name for n in model.graph.node if n.op_type == 'Cast' and n.name not in blocked}
        model = float16.convert_float_to_float16(model, keep_io_types=False,
                                                 disable_shape_infer=True, node_block_list=blocked)
        # The converter updates value_info but retains explicit rotary Cast(to=FLOAT).
        # Keep those operator attributes consistent with FP16 activation types.
        for node in model.graph.node:
            if node.op_type == 'Cast' and node.name in original_casts:
                for attribute in node.attribute:
                    if attribute.name == 'to' and attribute.i == onnx.TensorProto.FLOAT:
                        attribute.i = onnx.TensorProto.FLOAT16
        # Only the final hidden state/logit row is used by autoregressive decoding.
        # Selecting it inside the graph keeps the bridge and KV tensors resident on GPU.
        output_name = 'hidden' if part == 'base' else 'y'
        internal = output_name + '_all_rows'
        for node in model.graph.node:
            for i, name in enumerate(node.output):
                if name == output_name:
                    node.output[i] = internal
            for i, name in enumerate(node.input):
                if name == output_name:
                    node.input[i] = internal
        for name, values in [('last_start', [-1]), ('last_end', [9223372036854775807]), ('last_axis', [1])]:
            model.graph.initializer.append(onnx.numpy_helper.from_array(np.array(values, dtype=np.int64), name))
        model.graph.node.append(onnx.helper.make_node('Slice', [internal, 'last_start', 'last_end', 'last_axis'], [output_name], name='LastOutputRow'))
        model.graph.output[0].type.tensor_type.shape.dim[1].ClearField('dim_param')
        model.graph.output[0].type.tensor_type.shape.dim[1].dim_value = 1
        config = DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True,
                                              accuracy_level=0, bits=4,
                                              quant_format=QuantFormat.QOperator,
                                              op_types_to_quantize=('MatMul',))
        target = output / f'model_{part}.w{args.bits}a16.onnx'
        quantizer = None
        if args.bits == 4:
            quantizer = MatMulNBitsQuantizer(model, algo_config=config)
            quantizer.process()
            quantizer.model.save_model_to_file(str(target), use_external_data_format=False)
        else:
            onnx.save(model, target)
        converted = onnx.load(target)
        onnx.checker.check_model(converted, full_check=True)
        initializers = {t.name: t for t in converted.graph.initializer}
        types = collections.Counter(onnx.TensorProto.DataType.Name(t.data_type)
                                    for t in converted.graph.initializer)
        matmuls = [n for n in converted.graph.node if n.op_type == 'MatMulNBits']
        scale_types = sorted({onnx.TensorProto.DataType.Name(initializers[n.input[2]].data_type)
                              for n in matmuls})
        floating_io = [v for v in list(converted.graph.input) + list(converted.graph.output)
                       if v.type.tensor_type.elem_type in [onnx.TensorProto.FLOAT, onnx.TensorProto.FLOAT16]]
        if any(v.type.tensor_type.elem_type != onnx.TensorProto.FLOAT16 for v in floating_io):
            raise ValueError('Floating IO is not FP16')
        if args.bits == 4 and (scale_types != ['FLOAT16'] or not matmuls):
            raise ValueError('Invalid W4A16 quantized MatMuls')
        report['files'][part] = dict(name=target.name, bytes=target.stat().st_size,
                                    sha256=digest(target), sourceBytes=path.stat().st_size,
                                    matMulNBits=len(matmuls), scaleTypes=scale_types,
                                    initializerTypes=dict(types),
                                    floatingIO=[v.name for v in floating_io],
                                    seconds=time.perf_counter()-started)
        print(json.dumps({part: report['files'][part]}), flush=True)
        del model, quantizer, converted
    report['bytes'] = sum(f['bytes'] for f in report['files'].values())
    (output / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
