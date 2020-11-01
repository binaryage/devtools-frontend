/* eslint-disable rulesdir/check_license_header,no-console */

import * as DiracAngel from './DiracAngel.js';

console.log('dirac API import!');

export { DiracAngel };
export * from './DiracAngel.js';

// this is dirty, make dirac globally available for implant code
globalThis.diracAngel = DiracAngel;

globalThis.initDiracImplantAfterLoad = true;
// eslint-disable-next-line no-console
console.log('implant will be initialized after load');

// eslint-disable-next-line no-console
console.log('dirac API import done');
