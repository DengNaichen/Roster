import { SpecStatusBadge } from "./SpecStatus";
import type { SpecView } from "./specView";
import "./spec.css";

export default function SpecDocument({ spec }: { spec: SpecView }) {
  return (
    <>
      <div className="spec-scroll">
        <article className="spec-content">
          <header className="spec-heading">
            <p className="spec-kicker">Feature specification</p>
            <h1>{spec.title}</h1>
            <dl className="spec-facts">
              <div>
                <dt>Status</dt>
                <dd>
                  <SpecStatusBadge status={spec.status} />
                </dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd className="spec-mono">{spec.branch}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{spec.created}</dd>
              </div>
            </dl>
          </header>

          <section className="spec-section" aria-labelledby="spec-scenarios">
            <h2 id="spec-scenarios">User Scenarios &amp; Testing</h2>
            <div className="spec-stories">
              {spec.stories.map((story) => (
                <section
                  className="spec-story"
                  id={story.id}
                  key={story.id}
                  aria-label={`${story.id} ${story.title}`}
                >
                  <header>
                    <span className={`spec-priority ${story.priority.toLowerCase()}`}>
                      {story.priority}
                    </span>
                    <h3>{story.title}</h3>
                    <span className="spec-id">{story.id}</span>
                  </header>
                  <p>{story.description}</p>
                  <dl className="spec-story-notes">
                    <div>
                      <dt>Why this priority</dt>
                      <dd>{story.why}</dd>
                    </div>
                    <div>
                      <dt>Independent test</dt>
                      <dd>{story.independentTest}</dd>
                    </div>
                  </dl>
                  <h4>Acceptance scenarios</h4>
                  <ol className="spec-scenarios">
                    {story.scenarios.map((s, i) => (
                      <li key={i}>
                        <span>
                          <b>Given</b> {s.given}
                        </span>
                        <span>
                          <b>When</b> {s.when}
                        </span>
                        <span>
                          <b>Then</b> {s.then}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
            <h3 className="spec-subheading">Edge cases</h3>
            <ul className="spec-edge-cases">
              {spec.edgeCases.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </section>

          <section className="spec-section" aria-labelledby="spec-requirements">
            <h2 id="spec-requirements">Requirements</h2>
            <h3 className="spec-subheading">Functional requirements</h3>
            <ul className="spec-list">
              {spec.requirements.map((r) => (
                <li id={r.id} key={r.id}>
                  <span className="spec-id">{r.id}</span>
                  <span className="spec-list-text">
                    {r.text}
                    {r.clarify && (
                      <>
                        {" "}
                        <mark className="spec-clarify">NEEDS CLARIFICATION: {r.clarify}</mark>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <h3 className="spec-subheading">Key entities</h3>
            <ul className="spec-entities">
              {spec.entities.map((e) => (
                <li key={e.name}>
                  <strong>{e.name}</strong>
                  <span>{e.description}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="spec-section" aria-labelledby="spec-success">
            <h2 id="spec-success">Success Criteria</h2>
            <ul className="spec-list">
              {spec.successCriteria.map((c) => (
                <li id={c.id} key={c.id}>
                  <span className="spec-id">{c.id}</span>
                  <span className="spec-list-text">{c.text}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="spec-section" aria-labelledby="spec-clarifications">
            <h2 id="spec-clarifications">Clarifications</h2>
            {spec.clarifications.map((session) => (
              <div key={session.date}>
                <h3 className="spec-subheading">Session {session.date}</h3>
                <ul className="spec-qa">
                  {session.items.map((item) => (
                    <li key={item.question}>
                      <span>
                        <b>Q</b>
                        {item.question}
                      </span>
                      <span>
                        <b>A</b>
                        {item.answer}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </article>
      </div>
    </>
  );
}
