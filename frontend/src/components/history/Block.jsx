/**
 * One analysis block on a disaster page: a numbered, full-width section whose
 * cards stack one per row. The section heading is h2; the cards inside use h3.
 */
export function Block({ id, index, title, lead, children }) {
  return (
    <section className="block" aria-labelledby={`${id}-title`} id={id}>
      <header className="block-header">
        <p className="block-index" aria-hidden="true">
          {String(index).padStart(2, '0')}
        </p>
        <div>
          <h2 className="block-title" id={`${id}-title`}>
            {title}
          </h2>
          {lead && <p className="block-lead">{lead}</p>}
        </div>
      </header>
      <div className="stack">{children}</div>
    </section>
  )
}

/** A plain card with a heading, badge and body, for blocks that are not charts. */
export function InfoCard({ title, insight, badge, children, headingLevel = 3 }) {
  const Heading = `h${headingLevel}`
  return (
    <section className="card">
      <div className="card-header">
        <div className="card-heading">
          <Heading className="card-title">{title}</Heading>
          {insight && <p className="card-insight">{insight}</p>}
        </div>
        {badge && <div className="card-badge">{badge}</div>}
      </div>
      {children}
    </section>
  )
}

export default Block
