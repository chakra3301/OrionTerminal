// src/apps/archives/learn/LessonView.tsx
// Lesson page — rendered when a constellation node is opened.
// Spine column: concept chunks (one at a time), worked example, key terms,
// resources (with "Find real links"), and recall checks (answer-first, graded).
import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Search,
  Link2,
  Loader2,
  RotateCcw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  BookOpen,
} from "lucide-react";
import { useLearn } from "./useLearn";
import { parseLesson, type LessonVisual as Visual } from "./learnTypes";
import { LessonVisual } from "./LessonVisual";
import type { Grade } from "./claude";

// ── Markdown renderer — mirrors ClaudeChat.tsx config exactly ─────────────
function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
      {children}
    </ReactMarkdown>
  );
}

// ── Mastery meter ─────────────────────────────────────────────────────────
function MasteryMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="ll-mastery-wrap" title={`Mastery ${pct}%`}>
      <div className="ll-mastery-track">
        <div className="ll-mastery-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="ll-mastery-label">{pct}%</span>
    </div>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────
function SkeletonLoader() {
  return (
    <div className="ll-skeleton">
      <div className="ll-skel-bar ll-skel-bar--wide" />
      <div className="ll-skel-bar ll-skel-bar--med" />
      <div className="ll-skel-bar ll-skel-bar--full" />
      <div className="ll-skel-bar ll-skel-bar--full" />
      <div className="ll-skel-bar ll-skel-bar--wide" />
    </div>
  );
}

// ── Recall question ───────────────────────────────────────────────────────
interface RecallItemProps {
  index: number;
  prompt: string;
  expected: string;
  concept: string;
  nodeId: string;
  pMasteryBefore: number;
}

function RecallItem({ index, prompt, expected, concept, nodeId, pMasteryBefore }: RecallItemProps) {
  const submitAnswer = useLearn((s) => s.submitAnswer);
  const pMastery = useLearn((s) => s.nodes[nodeId]?.p_mastery ?? pMasteryBefore);

  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [masteryBefore, setMasteryBefore] = useState<number | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!answer.trim() || pending) return;
    setPending(true);
    setMasteryBefore(pMastery);
    try {
      const result = await submitAnswer(nodeId, { question: prompt, expected, concept, answer });
      setGrade(result);
    } finally {
      setPending(false);
    }
  }, [answer, pending, pMastery, submitAnswer, nodeId, prompt, expected, concept]);

  const masteryDelta = grade !== null && masteryBefore !== null
    ? pMastery - masteryBefore
    : null;

  return (
    <div className="ll-recall-item">
      <div className="ll-recall-num">Q{index + 1}</div>
      <div className="ll-recall-body">
        <p className="ll-recall-prompt">{prompt}</p>

        {grade === null ? (
          <>
            <textarea
              className="ll-recall-textarea"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Write your answer…"
              rows={3}
            />
            <div className="ll-recall-actions">
              <button
                className="ll-btn ll-btn--ghost ll-btn--sm"
                type="button"
                onClick={() => setRevealed((r) => !r)}
              >
                {revealed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {revealed ? "Hide answer" : "Reveal answer"}
              </button>
              <button
                className="ll-btn ll-btn--primary ll-btn--sm"
                type="button"
                disabled={!answer.trim() || pending}
                onClick={() => void handleSubmit()}
              >
                {pending ? <Loader2 size={13} className="ll-spin" /> : null}
                Submit
              </button>
            </div>
            {revealed && (
              <div className="ll-recall-expected">
                <span className="ll-recall-expected-label">Expected:</span>
                {expected}
              </div>
            )}
          </>
        ) : (
          <div className={`ll-grade ll-grade--${grade.correct ? "correct" : grade.partial ? "partial" : "wrong"}`}>
            <div className="ll-grade-header">
              {grade.correct
                ? <CheckCircle2 size={15} className="ll-grade-icon" />
                : grade.partial
                ? <AlertCircle size={15} className="ll-grade-icon" />
                : <XCircle size={15} className="ll-grade-icon" />}
              <span className="ll-grade-verdict">
                {grade.correct ? "Correct!" : grade.partial ? "Partially correct" : "Needs review"}
              </span>
              {masteryDelta !== null && (
                <span className="ll-grade-delta">
                  {masteryDelta >= 0 ? "+" : ""}{Math.round(masteryDelta * 100)}% mastery
                </span>
              )}
            </div>
            {grade.missed_concepts.length > 0 && (
              <div className="ll-grade-misses">
                <span className="ll-grade-misses-label">Missed:</span>
                {grade.missed_concepts.join(", ")}
              </div>
            )}
            <div className="ll-grade-answer">
              <span className="ll-grade-answer-label">Your answer:</span> {answer}
            </div>
            <button
              className="ll-btn ll-btn--ghost ll-btn--sm ll-retry-btn"
              type="button"
              onClick={() => { setGrade(null); setAnswer(""); setRevealed(false); setMasteryBefore(null); }}
            >
              <RotateCcw size={12} /> Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────
export function LessonView() {
  const openNodeId      = useLearn((s) => s.openNodeId);
  const openTopicId     = useLearn((s) => s.openTopicId);
  const topics          = useLearn((s) => s.topics);
  const nodes           = useLearn((s) => s.nodes);
  const generatingLesson = useLearn((s) => s.generatingLesson);
  const closeNode       = useLearn((s) => s.closeNode);
  const openNode        = useLearn((s) => s.openNode);
  const findLinks       = useLearn((s) => s.findLinks);

  const [revealedChunks, setRevealedChunks] = useState(1);
  const [findingLinks, setFindingLinks] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const node = openNodeId ? nodes[openNodeId] : null;
  const topic = openTopicId ? topics[openTopicId] : null;

  // Re-parse from store whenever lesson_json updates (find-real-links patches it)
  const lesson = node?.lesson_json ? parseLesson(node.lesson_json) : null;
  const isEmpty = lesson
    ? (!lesson.objective && lesson.concept_chunks.length === 0 && lesson.recall_check.length === 0)
    : false;

  // ── Find real links handler ──────────────────────────────────────────
  const handleFindLinks = useCallback(async () => {
    if (!openNodeId || findingLinks) return;
    setFindingLinks(true);
    try {
      await findLinks(openNodeId);
    } finally {
      setFindingLinks(false);
    }
  }, [openNodeId, findLinks, findingLinks]);

  // ── Loading state ────────────────────────────────────────────────────
  if (!openNodeId || !node) return null;

  if (generatingLesson || (node.lesson_json === null && !isEmpty)) {
    return (
      <div className="ll-spine">
        <div className="ll-breadcrumb">
          <button className="ll-back-btn" onClick={closeNode} type="button">
            <ChevronLeft size={14} />
            <span>Back</span>
          </button>
        </div>
        <SkeletonLoader />
      </div>
    );
  }

  // ── Empty / error state ───────────────────────────────────────────────
  if (!lesson || isEmpty) {
    return (
      <div className="ll-spine">
        <div className="ll-breadcrumb">
          <button className="ll-back-btn" onClick={closeNode} type="button">
            <ChevronLeft size={14} />
            <span>Back</span>
          </button>
        </div>
        <div className="ll-empty">
          <BookOpen size={32} className="ll-empty-icon" />
          <p>No lesson content yet.</p>
          <button
            className="ll-btn ll-btn--primary"
            type="button"
            onClick={() => void openNode(openNodeId)}
          >
            Generate lesson
          </button>
        </div>
      </div>
    );
  }

  const chunks   = lesson.concept_chunks;
  const total    = chunks.length;
  const allDone  = revealedChunks >= total;
  const pMastery = node.p_mastery;

  // Group visuals by the concept chunk they illustrate; anything with an
  // out-of-range or -1 chunk index becomes a general visual shown after the chunks.
  const visualsByChunk = new Map<number, Visual[]>();
  const generalVisuals: Visual[] = [];
  for (const v of lesson.visuals) {
    if (v.chunk >= 0 && v.chunk < total) {
      const arr = visualsByChunk.get(v.chunk) ?? [];
      arr.push(v);
      visualsByChunk.set(v.chunk, arr);
    } else {
      generalVisuals.push(v);
    }
  }

  return (
    <div className="ll-spine">
      {/* ── Breadcrumb ─────────────────────────────────────────────── */}
      <div className="ll-breadcrumb">
        <button className="ll-back-btn" onClick={closeNode} type="button">
          <ChevronLeft size={14} />
          <span>Back</span>
        </button>
        {topic && <span className="ll-bc-topic">{topic.title}</span>}
        {topic && <span className="ll-bc-sep">›</span>}
        <span className="ll-bc-node">{node.title}</span>
      </div>

      {/* ── Objective banner ───────────────────────────────────────── */}
      <div className="ll-objective">
        <span className="ll-objective-label">By the end you'll be able to</span>
        <p className="ll-objective-text">{lesson.objective}</p>
        <MasteryMeter value={pMastery} />
      </div>

      {/* ── Segmented progress bar ─────────────────────────────────── */}
      {total > 0 && (
        <div className="ll-progress" role="progressbar" aria-valuenow={revealedChunks} aria-valuemax={total}>
          {chunks.map((_, i) => (
            <div
              key={i}
              className={`ll-progress-seg${i < revealedChunks ? " ll-progress-seg--done" : ""}`}
            />
          ))}
        </div>
      )}

      {/* ── Concept chunks (one at a time) ─────────────────────────── */}
      <div className="ll-chunks">
        {chunks.slice(0, revealedChunks).map((chunk, i) => (
          <div key={i} className="ll-chunk">
            {chunk.tag && <div className="ll-chunk-tag">{chunk.tag}</div>}
            <div className="ll-chunk-body">
              <Markdown>{chunk.body}</Markdown>
            </div>
            {(visualsByChunk.get(i) ?? []).map((v, vi) => <LessonVisual key={vi} v={v} />)}
          </div>
        ))}
        {!allDone && (
          <button
            className="ll-continue-btn"
            type="button"
            onClick={() => setRevealedChunks((n) => Math.min(n + 1, total))}
          >
            Continue
            <ChevronDown size={14} />
          </button>
        )}
      </div>

      {/* ── Remaining content (shown after all chunks revealed) ────── */}
      {allDone && (
        <>
          {/* General / overview visuals */}
          {generalVisuals.length > 0 && (
            <div className="ll-section">
              <h3 className="ll-section-title">Visualize It</h3>
              {generalVisuals.map((v, i) => <LessonVisual key={i} v={v} />)}
            </div>
          )}

          {/* Worked example */}
          {lesson.worked_example && (
            <div className="ll-section">
              <h3 className="ll-section-title">Worked Example</h3>
              <div className="ll-worked">
                <div className="ll-worked-title">{lesson.worked_example.title}</div>
                <ol className="ll-worked-steps">
                  {lesson.worked_example.steps.map((step, i) => (
                    <li key={i} className="ll-worked-step">
                      <div className="ll-worked-step-text">{step.text}</div>
                      {step.why && (
                        <button
                          className="ll-why-toggle"
                          type="button"
                          onClick={() => setExpandedStep(expandedStep === i ? null : i)}
                          aria-expanded={expandedStep === i}
                        >
                          {expandedStep === i ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                          Why?
                        </button>
                      )}
                      {expandedStep === i && step.why && (
                        <div className="ll-why-body">{step.why}</div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {/* Key terms */}
          {lesson.key_terms.length > 0 && (
            <div className="ll-section">
              <h3 className="ll-section-title">Key Terms</h3>
              <div className="ll-terms">
                {lesson.key_terms.map((term, i) => (
                  <span key={i} className="ll-term-chip">{term}</span>
                ))}
              </div>
            </div>
          )}

          {/* Suggested resources */}
          {lesson.suggested_resources.length > 0 && (
            <div className="ll-section">
              <div className="ll-section-header">
                <h3 className="ll-section-title">Resources</h3>
                <button
                  className="ll-find-links-btn"
                  type="button"
                  onClick={() => void handleFindLinks()}
                  disabled={findingLinks}
                >
                  {findingLinks
                    ? <><Loader2 size={12} className="ll-spin" /> Finding links…</>
                    : <><Link2 size={12} /> Find real links</>}
                </button>
              </div>
              <ul className="ll-resources">
                {lesson.suggested_resources.map((r, i) => (
                  <li key={i} className="ll-resource-item">
                    <span className="ll-resource-type">{r.type}</span>
                    {r.url ? (
                      <a
                        className="ll-resource-title ll-resource-title--link"
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {r.title}
                        <ExternalLink size={11} className="ll-resource-ext" />
                      </a>
                    ) : (
                      <span className="ll-resource-title">{r.title}</span>
                    )}
                    {!r.url && r.search_query && (
                      <a
                        className="ll-resource-search"
                        href={`https://www.google.com/search?q=${encodeURIComponent(r.search_query)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Search: ${r.search_query}`}
                      >
                        <Search size={11} />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recall checks */}
          {lesson.recall_check.length > 0 && (
            <div className="ll-section ll-section--recall">
              <h3 className="ll-section-title">Recall Check</h3>
              <div className="ll-recalls">
                {lesson.recall_check.map((q, i) => (
                  <RecallItem
                    key={i}
                    index={i}
                    prompt={q.prompt}
                    expected={q.expected}
                    concept={q.concept}
                    nodeId={openNodeId}
                    pMasteryBefore={pMastery}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
