function distribution(logits) {
  const max = Math.max(...logits),
    sum = logits.reduce((s, x) => s + Math.exp(x - max), 0),
    normalizer = max + Math.log(sum);
  return logits.map((x) => x - normalizer);
}
export function compareSkyChoices(reference, actual) {
  if (reference.length !== actual.length || !reference.length)
    throw new Error('Mismatched precision samples');
  const groups = {
    all: { count: 0, agreed: 0, kl: 0, maxKl: 0 },
    pitch: { count: 0, agreed: 0, kl: 0, maxKl: 0 },
    duration: { count: 0, agreed: 0, kl: 0, maxKl: 0 },
  };
  reference.forEach((a, i) => {
    const b = actual[i];
    if (
      a.note !== b.note ||
      a.position !== b.position ||
      a.allowed.join(',') !== b.allowed.join(',') ||
      a.logits.length !== a.allowed.length ||
      b.logits.length !== a.allowed.length ||
      [...a.logits, ...b.logits].some((x) => !Number.isFinite(x))
    )
      throw new Error('Mismatched or non-finite logits');
    const p = distribution(a.logits),
      q = distribution(b.logits);
    const kl = Math.max(
      0,
      p.reduce((s, x, j) => s + Math.exp(x) * (x - q[j]), 0),
    );
    const agreed =
      a.logits.indexOf(Math.max(...a.logits)) === b.logits.indexOf(Math.max(...b.logits));
    for (const group of [
      'all',
      ...(a.position === 5 ? ['pitch'] : a.position === 7 ? ['duration'] : []),
    ]) {
      const stats = groups[group];
      stats.count++;
      stats.agreed += Number(agreed);
      stats.kl += kl;
      stats.maxKl = Math.max(stats.maxKl, kl);
    }
  });
  return Object.fromEntries(
    Object.entries(groups).map(([name, s]) => [
      name,
      {
        decisions: s.count,
        top1Agreement: s.count ? s.agreed / s.count : null,
        meanKl: s.count ? s.kl / s.count : null,
        maxKl: s.count ? s.maxKl : null,
      },
    ]),
  );
}
