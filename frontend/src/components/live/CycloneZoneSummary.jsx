import { useMemo } from 'react'
import { CYCLONE_ZONES, ZONE_MAX_KM, districtLabel, districtsByZone, zoneCount, zoneRange } from '../../lib/cycloneZones'
import { plural } from '../../lib/format'

/** Districts named per zone before "and N more". */
const LIST_LIMIT = 20

/**
 * Indian districts inside the impact rings of the cyclones active now, by
 * zone, for the Cyclone page. The same rings as the World Map: fixed
 * distances from each storm's centre, checked against district centroids.
 */
export function CycloneZoneSummary({ events }) {
  const storms = useMemo(
    () =>
      events
        .filter((event) => event.type === 'cyclone')
        .map((event) => ({ event, groups: districtsByZone(event.latitude, event.longitude) }))
        .filter(({ groups }) => zoneCount(groups) > 0),
    [events],
  )
  const active = events.filter((event) => event.type === 'cyclone').length

  return (
    <div className="zone-summary">
      <h4 className="zone-summary-title">Indian districts in cyclone impact zones</h4>
      {storms.length === 0 ? (
        <p className="text-sm secondary">
          {active === 0
            ? 'No active cyclone is reported right now.'
            : `No Indian district lies within ${ZONE_MAX_KM} km of the ${plural(active, 'active cyclone', 'active cyclones')}.`}
        </p>
      ) : (
        storms.map(({ event, groups }) => (
          <section key={event.id} className="zone-summary-storm">
            <p className="zone-summary-name">
              {event.storm_name ?? event.title}: {plural(zoneCount(groups), 'district', 'districts')} within {ZONE_MAX_KM} km
            </p>
            <ul className="zone-summary-list">
              {CYCLONE_ZONES.filter((zone) => groups[zone.id].length > 0).map((zone) => {
                const list = groups[zone.id]
                return (
                  <li key={zone.id}>
                    <span className="zone-summary-zone">
                      <span className="zone-swatch" style={{ background: zone.color }} aria-hidden="true" />
                      {zone.label} <span className="secondary">({zoneRange(zone)})</span>
                    </span>
                    <span className="text-sm">
                      {list
                        .slice(0, LIST_LIMIT)
                        .map(districtLabel)
                        .join('; ')}
                      {list.length > LIST_LIMIT && `; and ${list.length - LIST_LIMIT} more`}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
      <p className="card-footnote">
        Fixed rings of 50, 150, 300 and 500 km from each storm&rsquo;s centre, not its forecast wind radii. A district is counted
        by its centre point, so districts on a ring edge are approximate. For warnings, follow IMD.
      </p>
    </div>
  )
}

export default CycloneZoneSummary
