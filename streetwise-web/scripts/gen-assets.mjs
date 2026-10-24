// Generates public/mascots/*.svg, public/icons/*.png and public/data/demo-route.json.
// The mascot art is the same SVG source used for the "Mascot" component set in Figma,
// so the app and the design file stay in sync. Run: npm run assets
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = (p) => path.join(root, 'public', p);

// ---------------------------------------------------------------- mascots
const O = '#1A1D26', SW = 2.5;
const st = `stroke="${O}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round"`;
const eye = (x, y, r = 5.5) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#FFFFFF" ${st}/><circle cx="${x + 0.8}" cy="${y + 0.6}" r="${r * 0.55}" fill="${O}"/><circle cx="${x + 1.8}" cy="${y - 0.8}" r="${r * 0.2}" fill="#FFFFFF"/>`;
const cheeks = (y, l = 46, r = 74) => `<circle cx="${l}" cy="${y}" r="3.2" fill="#F2A7A0" opacity="0.8"/><circle cx="${r}" cy="${y}" r="3.2" fill="#F2A7A0" opacity="0.8"/>`;
const tongue = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="4.2" ry="3.8" fill="${O}"/><ellipse cx="${x}" cy="${y + 1.6}" rx="2.4" ry="1.5" fill="#F2A7A0"/>`;

const A = {
  scout: { bg: '#DCE3FF', draw: (talk) => `
  <ellipse cx="72" cy="104" rx="5" ry="2.5" fill="#E8845B" ${st}/><ellipse cx="50" cy="104" rx="5" ry="2.5" fill="#E8845B" ${st}/>
  <ellipse cx="60" cy="80" rx="30" ry="25" fill="#8C9BB5" ${st}/>
  <ellipse cx="60" cy="88" rx="17" ry="14" fill="#B8C3D6"/>
  <ellipse cx="81" cy="82" rx="13" ry="16" fill="#7887A2" ${st} transform="rotate(-20 81 82)"/>
  <ellipse cx="60" cy="63" rx="19" ry="7" fill="#5FB3A1" ${st}/>
  <circle cx="60" cy="46" r="21" fill="#9AA8C0" ${st}/>
  ${eye(51, 46)}${eye(69, 46)}${cheeks(55, 44, 76)}
  <ellipse cx="60" cy="52" rx="4" ry="2" fill="#E9E4DA"/>
  ${talk ? `<path d="M55 54 L65 54 L60 58 Z" fill="#3B3F4A" ${st}/><ellipse cx="60" cy="60" rx="3.4" ry="2.4" fill="${O}"/><path d="M56 62 L64 62 L60 65 Z" fill="#3B3F4A" ${st}/>`
         : `<path d="M55 54 L65 54 L60 61 Z" fill="#3B3F4A" ${st}/>`}
  <path d="M39 40 C39 22 81 22 81 40 Z" fill="#6B83FF" ${st}/>
  <path d="M74 38 Q93 37 96 44 Q84 45 72 42 Z" fill="#4A63E8" ${st}/>
  <circle cx="60" cy="26" r="2.6" fill="#ECE7DC" ${st}/>` },
  watcher: { bg: '#D7F3E8', draw: (talk) => `
  <g transform="rotate(28 94 80)"><ellipse cx="94" cy="80" rx="10" ry="23" fill="#9A9FA9" ${st}/><ellipse cx="94" cy="72" rx="9.4" ry="3.5" fill="#3A3E48"/><ellipse cx="94" cy="84" rx="9.6" ry="3.5" fill="#3A3E48"/><ellipse cx="94" cy="96" rx="7" ry="3" fill="#3A3E48"/></g>
  <ellipse cx="58" cy="84" rx="27" ry="23" fill="#8A8F99" ${st}/>
  <ellipse cx="58" cy="90" rx="15" ry="13" fill="#C9CBD1"/>
  <path d="M37 36 L33 16 L51 29 Z" fill="#8A8F99" ${st}/><path d="M79 36 L83 16 L65 29 Z" fill="#8A8F99" ${st}/>
  <path d="M39 31 L37 22 L45 28 Z" fill="#F2A7A0"/><path d="M77 31 L79 22 L71 28 Z" fill="#F2A7A0"/>
  <ellipse cx="58" cy="49" rx="27" ry="22" fill="#8A8F99" ${st}/>
  <ellipse cx="58" cy="56" rx="18" ry="12" fill="#E4E5E9"/>
  <path d="M33 45 Q45 36 58 45 Q71 36 83 45 Q78 56 67 52 Q58 49 49 52 Q38 56 33 45 Z" fill="#3A3E48"/>
  ${eye(48, 46)}${eye(68, 46)}
  <ellipse cx="58" cy="57" rx="4.2" ry="3" fill="${O}"/>
  ${talk ? tongue(58, 64.5) : `<path d="M53 62 Q58 66 63 62" fill="none" ${st}/>`}
  <rect x="36" y="66" width="44" height="9" rx="4.5" fill="#4FD1A5" ${st}/>
  <path d="M68 72 L74 88 L80 86 L76 72 Z" fill="#4FD1A5" ${st}/>` },
  rescuer: { bg: '#FFE2CF', draw: (talk) => `
  <ellipse cx="60" cy="82" rx="27" ry="29" fill="#8B5E3C" ${st}/>
  <ellipse cx="60" cy="90" rx="16" ry="17" fill="#A9774F"/>
  <circle cx="60" cy="86" r="17" fill="none" stroke="${O}" stroke-width="12.5"/>
  <circle cx="60" cy="86" r="17" fill="none" stroke="#FF8A3D" stroke-width="8"/>
  <rect x="56" y="64.5" width="8" height="9" fill="#FFFFFF"/><rect x="56" y="98.5" width="8" height="9" fill="#FFFFFF"/>
  <rect x="38.5" y="82" width="9" height="8" fill="#FFFFFF"/><rect x="72.5" y="82" width="9" height="8" fill="#FFFFFF"/>
  <ellipse cx="40" cy="92" rx="7" ry="11" fill="#7A5133" ${st} transform="rotate(25 40 92)"/>
  <ellipse cx="80" cy="92" rx="7" ry="11" fill="#7A5133" ${st} transform="rotate(-25 80 92)"/>
  <ellipse cx="60" cy="42" rx="21" ry="19" fill="#8B5E3C" ${st}/>
  ${eye(51, 38)}${eye(69, 38)}${cheeks(50, 43, 77)}
  <ellipse cx="60" cy="51" rx="11" ry="7.5" fill="#B98A63"/>
  <ellipse cx="60" cy="47" rx="4" ry="3" fill="${O}"/>
  <path d="M48 50 L36 48 M48 53 L37 55 M72 50 L84 48 M72 53 L83 55" stroke="${O}" stroke-width="1.6" stroke-linecap="round"/>
  ${talk ? tongue(60, 55.5) : `<path d="M55 53.5 Q60 57 65 53.5" fill="none" ${st}/>`}` },
  reporter: { bg: '#ECE6D6', draw: (talk) => `
  <ellipse cx="51" cy="105" rx="5" ry="2.5" fill="#5A5F6E" ${st}/><ellipse cx="68" cy="105" rx="5" ry="2.5" fill="#5A5F6E" ${st}/>
  <ellipse cx="59" cy="80" rx="27" ry="26" fill="#33374A" ${st}/>
  <ellipse cx="59" cy="88" rx="15" ry="14" fill="#444A61"/>
  <path d="M50 26 L54 16 L58 26 L62 15 L64 27 Z" fill="#33374A" ${st}/>
  <circle cx="58" cy="45" r="21" fill="#33374A" ${st}/>
  ${eye(50, 43)}${eye(66, 43)}
  ${talk ? `<path d="M63 49 L86 51 L63 53.5 Z" fill="#6B7080" ${st}/><path d="M63 56 L81 61 L63 59 Z" fill="#6B7080" ${st}/>`
         : `<path d="M63 49 L87 53 L63 57 Z" fill="#6B7080" ${st}/>`}
  <g transform="rotate(-10 40 86)"><rect x="24" y="70" width="30" height="34" rx="3" fill="#F3E9D2" ${st}/>
  <path d="M29 79 H49 M29 85 H49 M29 91 H44" stroke="#B8AE96" stroke-width="1.8" stroke-linecap="round"/>
  <rect x="24" y="70" width="30" height="6" rx="2" fill="#EF4438" ${st}/></g>
  <ellipse cx="47" cy="94" rx="8" ry="11" fill="#2A2D3D" ${st} transform="rotate(30 47 94)"/>
  <g transform="rotate(35 84 84)"><rect x="81" y="70" width="6" height="26" rx="1.5" fill="#F2C14E" ${st}/><path d="M81 96 L84 102 L87 96 Z" fill="#E9D7B0" ${st}/></g>` },
  auditor: { bg: '#E9E2F6', draw: (talk) => `
  <ellipse cx="34" cy="62" rx="25" ry="18" fill="#B9A9D6" ${st} transform="rotate(-28 34 62)"/>
  <ellipse cx="86" cy="62" rx="25" ry="18" fill="#B9A9D6" ${st} transform="rotate(28 86 62)"/>
  <ellipse cx="40" cy="88" rx="15" ry="11" fill="#A393C6" ${st} transform="rotate(20 40 88)"/>
  <ellipse cx="80" cy="88" rx="15" ry="11" fill="#A393C6" ${st} transform="rotate(-20 80 88)"/>
  <circle cx="30" cy="60" r="6" fill="#8676B3"/><circle cx="90" cy="60" r="6" fill="#8676B3"/>
  <circle cx="30" cy="60" r="2.5" fill="#F3EDFF"/><circle cx="90" cy="60" r="2.5" fill="#F3EDFF"/>
  <ellipse cx="60" cy="80" rx="13" ry="22" fill="#EFE6D2" ${st}/>
  <path d="M50 84 H70 M51 92 H69 M53 99 H67" stroke="#D6C9AC" stroke-width="2" stroke-linecap="round"/>
  <ellipse cx="60" cy="62" rx="19" ry="9" fill="#FFF7E6" ${st}/>
  <path d="M53 33 Q46 20 38 15" fill="none" ${st}/><path d="M67 33 Q74 20 82 15" fill="none" ${st}/>
  <circle cx="38" cy="15" r="7" fill="#FFF7E6" opacity="0.45"/><circle cx="82" cy="15" r="7" fill="#FFF7E6" opacity="0.45"/>
  <circle cx="38" cy="15" r="3.6" fill="#FFF7E6" ${st}/><circle cx="82" cy="15" r="3.6" fill="#FFF7E6" ${st}/>
  <circle cx="60" cy="46" r="16" fill="#EFE6D2" ${st}/>
  <circle cx="53" cy="45" r="5.5" fill="${O}"/><circle cx="67" cy="45" r="5.5" fill="${O}"/>
  <circle cx="54.6" cy="43.2" r="1.7" fill="#FFFFFF"/><circle cx="68.6" cy="43.2" r="1.7" fill="#FFFFFF"/>
  ${cheeks(51, 47, 73)}
  ${talk ? tongue(60, 55) : `<path d="M56 53.5 Q60 56.5 64 53.5" fill="none" ${st}/>`}` },
};
const think = `<circle cx="96" cy="20" r="13" fill="#FFFFFF" ${st}/><circle cx="81" cy="36" r="3.5" fill="#FFFFFF" ${st}/><circle cx="90" cy="20" r="2" fill="${O}"/><circle cx="96" cy="20" r="2" fill="${O}"/><circle cx="102" cy="20" r="2" fill="${O}"/>`;
const done = `<circle cx="98" cy="98" r="13" fill="#4FD1A5" ${st}/><path d="M91 98 L96 103 L105 93" fill="none" stroke="${O}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
const svgFor = (a, state, withBg = true) => `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120" fill="none">${withBg ? `<circle cx="60" cy="60" r="58" fill="${A[a].bg}"/>` : ''}${A[a].draw(state === 'talking')}${state === 'thinking' ? think : state === 'done' ? done : ''}</svg>`;

fs.mkdirSync(out('mascots'), { recursive: true });
for (const a of Object.keys(A)) for (const s of ['idle', 'talking', 'thinking', 'done']) fs.writeFileSync(out(`mascots/${a}-${s}.svg`), svgFor(a, s));

// ---------------------------------------------------------------- icons
fs.mkdirSync(out('icons'), { recursive: true });
const iconSvg = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 120 120"><rect width="120" height="120" rx="${pad ? 0 : 26}" fill="#10141C"/><g transform="translate(${pad ? 18 : 10} ${pad ? 18 : 10}) scale(${pad ? 0.7 : 0.8333})">${svgFor('scout', 'idle').replace(/^<svg[^>]*>/, '').replace('</svg>', '')}</g></svg>`;
await sharp(Buffer.from(iconSvg(192, false))).resize(192, 192).png().toFile(out('icons/icon-192.png'));
await sharp(Buffer.from(iconSvg(512, false))).resize(512, 512).png().toFile(out('icons/icon-512.png'));
await sharp(Buffer.from(iconSvg(512, true))).resize(512, 512).png().toFile(out('icons/icon-512-maskable.png'));

// ---------------------------------------------------------------- demo data
// Geometry: real OpenStreetMap streets, routed with the public OSRM foot profile
// (Montgomery BART → New Montgomery → Mission → 4th → Howard → 5th → Folsom).
// Replace with the City pipeline's export (data/spike_score.py) for scored segments.
let route = [[-122.401991,37.788929],[-122.401948,37.788627],[-122.401524,37.78828],[-122.401043,37.78789],[-122.400821,37.787705],[-122.40061,37.787536],[-122.400509,37.787455],[-122.400586,37.787397],[-122.401273,37.78686],[-122.401617,37.786593],[-122.401735,37.786502],[-122.401959,37.786325],[-122.402041,37.786261],[-122.402152,37.786198],[-122.402286,37.786095],[-122.402494,37.785929],[-122.402548,37.785885],[-122.403368,37.785243],[-122.403467,37.785167],[-122.403518,37.785126],[-122.403837,37.784872],[-122.404207,37.784576],[-122.404257,37.784484],[-122.404169,37.784414],[-122.403854,37.784167],[-122.403794,37.784121],[-122.403734,37.784074],[-122.403406,37.78381],[-122.403359,37.783773],[-122.402824,37.783344],[-122.402708,37.783251],[-122.402755,37.783213],[-122.402802,37.783175],[-122.403299,37.782777],[-122.403771,37.78242],[-122.404111,37.78216],[-122.404261,37.78205],[-122.404285,37.781988],[-122.40445,37.781865],[-122.40485,37.781564],[-122.404942,37.781493],[-122.404869,37.781435],[-122.404638,37.781251],[-122.404557,37.781186],[-122.404423,37.781082],[-122.40394,37.780697],[-122.403677,37.780485],[-122.403647,37.780461],[-122.403537,37.780374],[-122.403503,37.780347],[-122.403431,37.780288],[-122.403354,37.780227],[-122.403317,37.780199],[-122.403093,37.780024],[-122.402907,37.779876],[-122.402854,37.779833]];
const shortest = [[-122.401991,37.788929],[-122.401948,37.788627],[-122.401524,37.78828],[-122.401043,37.78789],[-122.400821,37.787705],[-122.40061,37.787536],[-122.400509,37.787455],[-122.400431,37.78739],[-122.399996,37.787029],[-122.399518,37.786647],[-122.399084,37.786289],[-122.398984,37.786206],[-122.399053,37.786151],[-122.399323,37.785933],[-122.399444,37.785835],[-122.399884,37.785478],[-122.400391,37.785083],[-122.400585,37.784941],[-122.400677,37.784867],[-122.401105,37.784526],[-122.401599,37.784133],[-122.402034,37.783786],[-122.402195,37.783658],[-122.402447,37.783457],[-122.402608,37.783329],[-122.402708,37.783251],[-122.402802,37.783175],[-122.403299,37.782777],[-122.403771,37.78242],[-122.404111,37.78216],[-122.404261,37.78205],[-122.404285,37.781988],[-122.40445,37.781865],[-122.40485,37.781564],[-122.404942,37.781493],[-122.404869,37.781435],[-122.404638,37.781251],[-122.404423,37.781082],[-122.40394,37.780697],[-122.403677,37.780485],[-122.403537,37.780374],[-122.403431,37.780288],[-122.403317,37.780199],[-122.403093,37.780024],[-122.402907,37.779876],[-122.402854,37.779833]];

const demo = {
  _note: 'Demo corridor for the Friday 11 PM scenario. Geometry is real OSM streets; scores and stats are from the data spike (Route 1). Shops marked simulated:true are not real place agents.',
  scenario: { label: 'Friday · 11:04 PM', area: 'Downtown SF box', segmentsScored: 5025 },
  walker: { id: 'arya', name: 'Arya' },
  guardian: { name: 'Maya Chen', initials: 'M', channel: 'Live link + verified phone' },
  start: { name: 'Montgomery BART', lngLat: route[0] },
  end: { name: 'Home', lngLat: route[route.length - 1] },
  route,
  shortest,
  // Stretches with fewer working lights (bottom quarter of the area, score < 33)
  dimStretches: [
    { id: 'howard-4th-5th', name: 'Howard St · 4th → 5th', onRoute: true, meters: 44, score: 31, confidence: 'low',
      line: [[-122.403771,37.78242],[-122.404111,37.78216],[-122.404261,37.78205]],
      lampEvidence: '2 streetlight-out reports on this block; 1 lamp on our walk trace not working.',
      lampSource: 'SF 311 open data · 2025–26',
      openPlaces: 'Pharmacy on 4th, open till 12 (block is past it)', openSource: 'Apify Google Maps run · 11:00 PM',
      why: 'Fewer working lamps and no open doors here after 11, so the route only spends 44 m on it.' },
    { id: 'howard-newmont-3rd', name: 'Howard St · New Montgomery → 3rd', onRoute: false, meters: 115, score: 24, confidence: 'medium',
      line: [[-122.399884,37.785478],[-122.400391,37.785083],[-122.400585,37.784941],[-122.400677,37.784867],[-122.401105,37.784526]],
      lampEvidence: '3 streetlight-out reports along this stretch.', lampSource: 'SF 311 open data · 2025–26',
      openPlaces: 'No open places after 11 PM', openSource: 'OSM hours + Apify',
      why: 'Long stretch beside closed venues with lamp outages — the shortest path spends 115 m here.' },
  ],
  stopAt: [-122.40394, 37.78229],
  places: [
    { id: 'cafe-mia', name: 'Café Mia', kind: 'cafe', lngLat: [-122.40322, 37.78541], openUntil: '01:00', safeHaven: true, frontLight: true, simulated: false, address: 'Mission St, between 3rd & 4th' },
    { id: 'corner-market', name: 'Corner market', kind: 'market', lngLat: [-122.40448, 37.78465], openUntil: '24h', safeHaven: false, simulated: true },
    { id: 'pharmacy-4th', name: 'Pharmacy', kind: 'pharmacy', lngLat: [-122.40346, 37.78394], openUntil: '00:00', safeHaven: false, simulated: true },
    { id: 'hotel-lobby', name: 'Hotel lobby', kind: 'hotel', lngLat: [-122.40118, 37.78806], openUntil: 'lobby', safeHaven: true, simulated: true },
  ],
  stats: {
    streetwise: { score: 60, longestEmptyM: 44, minutes: 22.2 },
    shortest: { score: 49, longestEmptyM: 115, minutes: 20.1 },
  },
  darknessDebt: [
    { street: 'Howard St · New Montgomery → 3rd', minutes: 42 },
    { street: 'Howard St · 4th → 5th', minutes: 18 },
    { street: 'Tehama St · 4th → 5th', minutes: 11 },
  ],
};
fs.mkdirSync(out('data'), { recursive: true });
fs.writeFileSync(out('data/demo-route.json'), JSON.stringify(demo, null, 1));
console.log('assets written: 20 mascots, 3 icons, demo-route.json');
