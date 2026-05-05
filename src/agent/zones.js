export const ZONES = {
  'zone-1': { id: 'zone-1', name: 'Zone 1', area: 'Gallatin / Hendersonville', pm: 'Blake Neblett',  color: '#3b82f6', lat: 36.39, lng: -86.46 },
  'zone-2': { id: 'zone-2', name: 'Zone 2', area: 'Mt. Juliet / Lebanon',       pm: 'Brendan Embry', color: '#8b5cf6', lat: 36.20, lng: -86.52 },
  'zone-3': { id: 'zone-3', name: 'Zone 3', area: 'Murfreesboro / Smyrna',      pm: 'Jeb Brooks',    color: '#06b6d4', lat: 35.84, lng: -86.39 },
  'zone-4': { id: 'zone-4', name: 'Zone 4', area: 'Franklin / Brentwood',       pm: 'Taylor Hensley',color: '#22c55e', lat: 35.92, lng: -86.87 },
  'zone-5': { id: 'zone-5', name: 'Zone 5', area: 'Spring Hill / Columbia',     pm: 'Tim King',      color: '#f59e0b', lat: 35.75, lng: -86.93 },
  'zone-6': { id: 'zone-6', name: 'Zone 6', area: 'Clarksville',                pm: 'Derek Powers',  color: '#f97316', lat: 36.53, lng: -87.36 },
  'zone-7': { id: 'zone-7', name: 'Zone 7', area: 'Cookeville / Other',         pm: null,            color: '#6b7280', lat: 36.16, lng: -85.50 },
}

export const PM_TO_ZONE = {
  'Blake Neblett':   'zone-1',
  'Brendan Embry':   'zone-2',
  'Jeb Brooks':      'zone-3',
  'Taylor Hensley':  'zone-4',
  'Tim King':        'zone-5',
  'Derek Powers':    'zone-6',
}

export function getZoneId(job) {
  return job.zoneId || PM_TO_ZONE[job.pm] || PM_TO_ZONE[job.qbsPM] || 'zone-7'
}

export function getZone(job) {
  return ZONES[getZoneId(job)] || ZONES['zone-7']
}

export function getZoneName(zoneId) {
  return ZONES[zoneId]?.name || 'Zone ?'
}
