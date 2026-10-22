import React, { useMemo, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Sprout } from 'lucide-react';
import ScorePractice from './ScorePractice.jsx';
import BeginnerAction from './BeginnerAction.jsx';
import { BEGINNER_LESSONS, lessonScore, localize } from './beginnerLessons.js';
import { useLanguage } from './i18n.jsx';
function BeginnerGuide({ lesson, playing }) {
  const { lang } = useLanguage(),
    text = (zh, en) => (lang === 'zh' ? zh : en);
  const [checks, setChecks] = useState([]);
  return (
    <div className="beginner-guide">
      <div className="beginner-goal">
        <Sprout size={17} />
        <p>{localize(lesson.goal, lang)}</p>
        {lesson.minutes && (
          <span>{text(`建议 ${lesson.minutes} 分钟`, `~${lesson.minutes} min practice`)}</span>
        )}
      </div>
      <details className="beginner-instructions" open={!playing}>
        <summary>
          {text('练习做法与检查点', 'Instructions and checkpoints')}{' '}
          <span>
            {checks.length} / {lesson.checks.length}
          </span>
        </summary>
        <p>{localize(lesson.setup, lang)}</p>
        <ol>
          {lesson.steps.map((step, i) => (
            <li key={i}>{localize(step, lang)}</li>
          ))}
        </ol>
        {lesson.minutes && (
          <p className="beginner-time-note">
            {text(
              '建议时长包含准备、自检与休息；这一轮谱面的演奏时长随速度变化。',
              'Suggested time includes setup, self-checks, and rest. The score duration changes with tempo.',
            )}
          </p>
        )}
        <div className="beginner-checklist">
          {lesson.checks.map((check, i) => (
            <label key={i}>
              <input
                type="checkbox"
                checked={checks.includes(i)}
                onChange={(e) =>
                  setChecks((current) =>
                    e.target.checked ? [...current, i] : current.filter((n) => n !== i),
                  )
                }
              />
              <span>{localize(check, lang)}</span>
            </label>
          ))}
        </div>
        <p className="beginner-observation">
          {text(
            '麦克风提供音准与节奏参考；弓直、接触点、右臂高度和手型请对镜自检。',
            'The microphone provides pitch and timing feedback. Use a mirror to check straight bow travel, contact point, arm level, and hand shape.',
          )}
        </p>
      </details>
    </div>
  );
}
function savedLesson() {
  try {
    const id = localStorage.getItem('arco-beginner-lesson');
    return BEGINNER_LESSONS.findIndex((l) => l.id === id) >= 0 ? id : BEGINNER_LESSONS[0].id;
  } catch {
    return BEGINNER_LESSONS[0].id;
  }
}
export default function BeginnerPractice({ getAudioContext, reference }) {
  const { lang } = useLanguage(),
    text = (zh, en) => (lang === 'zh' ? zh : en);
  const [id, setId] = useState(savedLesson),
    [active, setActive] = useState(false);
  const index = BEGINNER_LESSONS.findIndex((l) => l.id === id),
    lesson = BEGINNER_LESSONS[index];
  const score = useMemo(() => lessonScore(lesson), [lesson]);
  useEffect(() => {
    try {
      localStorage.setItem('arco-beginner-lesson', id);
    } catch {}
  }, [id]);
  return (
    <div className="beginner-workspace">
      <div className="beginner-selector">
        <div>
          <span className="beginner-eyebrow">
            <Sprout size={14} />
            {text('从基础开始', 'START WITH THE BASICS')}
          </span>
          <h2>{text('初学者练习', 'Beginner practice')}</h2>
          <p>
            {text(
              '长弓 4 分钟 → 四弦 4 分钟 → 换弦 3 分钟；再按需要练左手。',
              'Long bows 4 min → open strings 4 min → crossings 3 min; then explore the left hand.',
            )}
          </p>
        </div>
        <label>
          {text('选择练习', 'Choose an exercise')}
          <select value={id} disabled={active} onChange={(e) => setId(e.target.value)}>
            {['bow', 'hand'].map((category) => (
              <optgroup
                key={category}
                label={
                  category === 'bow'
                    ? text('右手基础', 'Right-hand foundations')
                    : text('左手指法', 'Left-hand fingering')
                }
              >
                {BEGINNER_LESSONS.filter((l) => l.category === category).map((l) => (
                  <option key={l.id} value={l.id}>
                    {localize(l.title, lang)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="beginner-navigation">
          <button
            aria-label={text('上一项练习', 'Previous exercise')}
            disabled={active || index === 0}
            onClick={() => setId(BEGINNER_LESSONS[index - 1].id)}
          >
            <ChevronLeft size={17} />
          </button>
          <span>
            {index + 1} / {BEGINNER_LESSONS.length}
          </span>
          <button
            aria-label={text('下一项练习', 'Next exercise')}
            disabled={active || index === BEGINNER_LESSONS.length - 1}
            onClick={() => setId(BEGINNER_LESSONS[index + 1].id)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      <ScorePractice
        key={id}
        score={score}
        lesson={lesson}
        getAudioContext={getAudioContext}
        reference={reference}
        onActivityChange={setActive}
        renderAction={(state) => <BeginnerAction lesson={lesson} {...state} />}
        renderGuide={(state) => <BeginnerGuide lesson={lesson} {...state} />}
      />
    </div>
  );
}
