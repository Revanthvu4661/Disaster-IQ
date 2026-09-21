import { Link } from 'react-router-dom'
import { PageHeader } from '../components/ui'

export default function NotFound() {
  return (
    <div className="stack">
      <PageHeader title="Page not found" description="That route does not exist." />
      <section className="card">
        <Link to="/" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          Back to the dashboard
        </Link>
      </section>
    </div>
  )
}
