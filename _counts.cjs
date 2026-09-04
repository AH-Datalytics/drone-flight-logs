const DS = ['arpdtx', 'MCPDDFR', 'campbellpddfr', 'PSPDDFR', 'fremontpublicsafetydfr', 'oswegocountyuas'];
const BR = ['clovisca', 'schenectadyny', 'paradisepdca'];
const wide = 'startDate=2015-01-01T00:00:00.000Z&endDate=2026-12-31T23:59:59.000Z';

(async () => {
  console.log('=== DroneSense');
  for (const s of DS) {
    try {
      const meta = await (await fetch(`https://external.dronesense.com/v1/DashboardPages?url=${s}`)).json();
      const r = await (await fetch(`https://external.dronesense.com/v1/DashboardPages/Flights?url=${s}&images=false&page=1&pageSize=2000&${wide}`)).json();
      const n = Array.isArray(r) ? r.length : 0;
      const dates = Array.isArray(r) ? r.map(f => f.startDate).sort() : [];
      console.log(`  ${s.padEnd(24)} ${String(n).padStart(5)}  ${(meta.publicName || '?').slice(0, 38).padEnd(38)} ${(dates[0] || '').slice(0, 10)} .. ${(dates[dates.length - 1] || '').slice(0, 10)}`);
    } catch (e) { console.log(`  ${s.padEnd(24)} error ${e.message.slice(0, 40)}`); }
  }
  console.log('=== BRINC');
  for (const s of BR) {
    try {
      const agg = await (await fetch(`https://api.liveops.brincdrones.com/dfr/missions/aggregate?slug=${s}`)).json();
      const org = await (await fetch(`https://liveops.brincdrones.com/api/organizations/${s}`)).json();
      console.log(`  ${s.padEnd(24)} ${String(agg.data?.totalFlights ?? '?').padStart(5)}  ${(org.name || org.display_name || '?').slice(0, 38)}`);
    } catch (e) { console.log(`  ${s.padEnd(24)} error ${e.message.slice(0, 40)}`); }
  }
})();
