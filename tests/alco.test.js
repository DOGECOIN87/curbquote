import test from 'node:test';
import assert from 'node:assert/strict';
import { OFFICES, addressParts, officeFor, serviceArea } from '../alco.js';

test('matched addresses split into city, state and ZIP in Census and Google formats', () => {
  assert.deepEqual(addressParts('4600 SILVER HILL RD, WASHINGTON, DC, 20233'), { city: 'Washington', state: 'DC', zip: '20233' });
  assert.deepEqual(addressParts('7 Elm St, Bethesda, MD 20817, USA'), { city: 'Bethesda', state: 'MD', zip: '20817' });
  assert.deepEqual(addressParts('1 Chain Bridge Rd, MC LEAN, VA, 22101-1234'), { city: 'McLean', state: 'VA', zip: '22101' });
  assert.equal(addressParts('somewhere without a state'), null);
  assert.equal(addressParts(''), null);
});

test('DC and the listed communities are served, other DC-area ZIPs are "call to confirm", the rest are outside', () => {
  assert.equal(serviceArea('4600 SILVER HILL RD, WASHINGTON, DC, 20233').status, 'served');
  assert.equal(serviceArea('1 Main St, ROCKVILLE, MD, 20850').status, 'served');
  assert.equal(serviceArea('1 Chain Bridge Rd, MC LEAN, VA, 22101').status, 'served');
  assert.equal(serviceArea('1 Main St, Laurel, MD 20707').status, 'nearby');
  assert.equal(serviceArea('1 Main St, Ocean City, MD 21842').status, 'outside');
  assert.equal(serviceArea('1 Main St, Richmond, VA 23219').status, 'outside');
  assert.equal(serviceArea('1100 CONGRESS AVE, AUSTIN, TX, 78701').status, 'outside');
  assert.equal(serviceArea('no state here').status, 'unknown');
  assert.equal(serviceArea('no state here').message, '');
});

test('Virginia addresses route to the Tysons office and everywhere else to North Bethesda', () => {
  assert.equal(officeFor('VA'), OFFICES.tysons);
  assert.equal(officeFor('MD'), OFFICES.bethesda);
  assert.equal(officeFor('DC'), OFFICES.bethesda);
  const area = serviceArea('1 Main St, Arlington, VA 22201');
  assert.equal(area.office.phone, '(703) 534-3349');
  assert.match(area.message, /serves Arlington\. Questions\? Call \(703\) 534-3349\./);
  assert.match(serviceArea('1 Main St, Ocean City, MD 21842').message, /outside .*call \(301\) 593-1691/);
});
