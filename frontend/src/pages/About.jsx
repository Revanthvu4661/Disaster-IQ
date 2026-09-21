import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { PageHeader, Skeleton } from '../components/ui'
import { titleCase } from '../lib/format'

function Section({ title, children }) {
  return (
    <section className="card">
      <h2 className="card-title" style={{ marginBottom: 'var(--space-3)' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

export default function About() {
  const rules = useApi(() => api.rules(), [])

  return (
    <div className="stack">
      <PageHeader
        title="About DisasterIQ"
        description="What the data is, how the pipeline works, and what it cannot do."
      />

      <Section title="Data">
        <p className="text-sm secondary">
          The corpus is the Figure-Eight (Appen) disaster response dataset: roughly 26,000
          messages collected during the 2010 Haiti earthquake, the 2010 Chile earthquake,
          the 2010 Pakistan floods and Superstorm Sandy in 2012, labelled across 36
          categories. Messages arrive from three sources: direct SMS, news wires and social
          media. The dataset has no timestamps and no geocoordinates, so nothing in this
          application is a real time series or a real map of these events.
        </p>
      </Section>

      <Section title="Pipeline">
        <ol className="text-sm secondary" style={{ paddingLeft: 18, lineHeight: 1.9 }}>
          <li>
            ETL cleans the CSVs, removes duplicate ids and messages, flags{' '}
            <code>related = 2</code> rows as non-disaster noise, infers the disaster event
            from keywords and id ranges, and stores everything in SQLite.
          </li>
          <li>
            The classifier is chosen by a benchmark of six candidates. Thresholds are tuned
            per label on a validation split; all published metrics come from an untouched
            test split.
          </li>
          <li>
            Severity uses a weighted noisy-OR over life-threatening categories, so a single
            confident signal escalates instead of being averaged away.
          </li>
          <li>
            Recommendations come from an editable rule table, combining category rules,
            severity escalations and event-specific overlays.
          </li>
        </ol>
      </Section>

      <Section title="Recommendation rules">
        {rules.loading && <Skeleton height={80} />}
        {rules.data && (
          <>
            <p className="text-sm secondary">
              {rules.data.rule_count} category rules, {rules.data.escalation_count} severity
              escalations and {rules.data.overlay_count} event overlays, version{' '}
              {rules.data.version}. Responsible teams:
            </p>
            <div className="row" style={{ gap: 6, marginTop: 'var(--space-3)' }}>
              {Object.values(rules.data.agencies).map((agency) => (
                <span key={agency} className="chip">
                  {agency}
                </span>
              ))}
            </div>
            <details style={{ marginTop: 'var(--space-3)' }}>
              <summary className="text-sm" style={{ cursor: 'pointer' }}>
                Browse the rule table
              </summary>
              <div className="table-wrap" style={{ marginTop: 8, maxHeight: 320 }}>
                <table className="data">
                  <caption className="visually-hidden">Recommendation rules</caption>
                  <thead>
                    <tr>
                      <th scope="col">Category</th>
                      <th scope="col">Action</th>
                      <th scope="col">Team</th>
                      <th scope="col">Urgency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules.data.rules.map((rule) => (
                      <tr key={rule.id}>
                        <td>{titleCase(rule.category)}</td>
                        <td className="wrap">{rule.action}</td>
                        <td>{rule.agency}</td>
                        <td>{rule.urgency.replace('_', ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </Section>

      <Section title="Limitations">
        <ul className="text-sm secondary" style={{ paddingLeft: 18, lineHeight: 1.9 }}>
          <li>
            Rare labels (tools, shops, offers, fire, hospitals) have a few hundred examples
            at most, and <code>child_alone</code> has none. Their scores are unstable, which
            the <Link to="/model">Model page</Link> shows per label.
          </li>
          <li>
            Event labels are inferred, not ground truth. Around 46% of messages, mostly news
            wire copy, cannot be attributed to one of the four events and stay as Other.
          </li>
          <li>
            The corpus is from 2010 to 2012 and skews heavily towards Haiti, so vocabulary
            and needs elsewhere may be under-represented.
          </li>
          <li>
            Severity weights are an editorial judgement encoded in one file, not a
            statistically derived score.
          </li>
          <li>
            This is a decision-support prototype. It should never replace a trained
            dispatcher or an official warning system.
          </li>
        </ul>
      </Section>

      <Section title="Credits">
        <p className="text-sm secondary">
          Dataset: Figure-Eight / Appen disaster response messages. Hazard feeds: USGS
          earthquake catalogue, NASA EONET, GDACS. Map tiles: OpenStreetMap contributors.
          Icons: Lucide. Charts: Recharts.
        </p>
      </Section>
    </div>
  )
}
