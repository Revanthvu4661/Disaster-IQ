/**
 * Historical data sources, keyed by the ids the API returns in `source.id`.
 *
 * `short` is the badge text; `long` is shown in the badge's disclosure and on
 * the About page. Live feeds (USGS realtime, GDACS, NASA EONET) are described
 * by the live payload itself.
 */
export const SOURCES = {
  emdat: {
    short: 'OWID / EM-DAT',
    long: 'EM-DAT (CRED / UCLouvain) via Our World in Data: disaster impact summed by country and year.',
    url: 'https://ourworldindata.org/natural-disasters',
  },
  emdat_wdi: {
    short: 'OWID / EM-DAT + World Bank',
    long: 'EM-DAT damages divided by World Bank WDI GDP, as computed and published by Our World in Data.',
    url: 'https://ourworldindata.org/natural-disasters',
  },
  usgs: {
    short: 'USGS',
    long: 'USGS ComCat earthquake catalogue: every magnitude 6.0+ earthquake since 1900, with location and date.',
    url: 'https://earthquake.usgs.gov/earthquakes/search/',
  },
  ibtracs: {
    short: 'NOAA IBTrACS',
    long: 'NOAA IBTrACS v04r01 best tracks: every storm since 1980 that reached tropical-storm strength (34 kt).',
    url: 'https://www.ncei.noaa.gov/products/international-best-track-archive',
  },

  // Level 2 (flood risk) and Level 3 (resource allocation), Indian districts.
  ifi: {
    short: 'India Flood Inventory',
    long: 'India Flood Inventory v3.0 (IIT Delhi HydroSense Lab): flood events 1967-2023 compiled from IMD reports, with the districts each event touched and recorded deaths. The flood label the model is trained on.',
    url: 'https://github.com/hydrosenselab/India-Flood-Inventory',
  },
  nasa_power: {
    short: 'NASA POWER',
    long: 'NASA POWER daily point data (MERRA-2 based): precipitation and root-zone soil wetness at the 0.5° × 0.625° grid cell holding each district centre (districts in one cell share a series), 1981 to about 4 days ago.',
    url: 'https://power.larc.nasa.gov/',
  },
  elevation: {
    short: 'Copernicus DEM',
    long: 'Mean elevation from 17,488 points sampled inside the districts (at most about 25 per district), from Open-Elevation, with the Open-Meteo elevation API (Copernicus GLO-90) as the fallback.',
    url: 'https://open-meteo.com/en/docs/elevation-api',
  },
  census2011: {
    short: 'Census 2011',
    long: 'Census of India 2011 district population and households. Districts created after 2011 have no census row, so their population is unavailable, not estimated.',
    url: 'https://censusindia.gov.in/',
  },
  emdat_public: {
    short: 'EM-DAT public export',
    long: 'EM-DAT (CRED / UCLouvain) event list with a start year, month and day for each disaster, worldwide. Records with no start month or day are left out of the monthly and daily views.',
    url: 'https://public.emdat.be/',
  },
  kerala_imd: {
    short: 'Kerala flood dataset',
    long: 'IMD monthly rainfall for the Kerala subdivision 1901-2018 with a yes/no flood flag, one row per year for the whole state. Used as a check, not as the training label.',
    url: 'https://github.com/amandp13/Flood-Prediction-Model',
  },
  geoboundaries: {
    short: 'geoBoundaries',
    long: 'geoBoundaries India district (ADM2) and state (ADM1) boundaries, ODbL. Used for the district map, the state of each district and elevation sampling.',
    url: 'https://www.geoboundaries.org/',
  },
}

export const sourceName = (id) => SOURCES[id]?.short ?? id
