import { describe, expect, it } from 'vitest';
import { parseProjectInterestInput, parseProjectInterestResult, parseProjectInterestsPageQuery, parseProjectInterestsQuery, parseProjectInterestsScope, parseProjectInterestsSnapshot } from '../projectInterestsContracts';
import { piId, piInput, piResult, piScope, piSnapshot } from './projectInterestsFixtures';

describe('project interest contracts', () => {
  it('reads historical unknown status without admitting it as a command field', () => {
    const value = piSnapshot(); value.projects = []; value.customer.canAdd = false;
    value.interests = [{ id: piId(4), projectName: 'โครงการเก่า', ownerUserId: piId(6), revision: piId(5), status: 'legacy_unclassified', plotId: null }];
    expect(parseProjectInterestsSnapshot(value, piScope).interests[0].status).toBe('legacy_unclassified');
    expect(() => parseProjectInterestInput({ ...piInput(), status: 'legacy_unclassified' })).toThrow();
  });
  it('accepts existing customer and optional TEXT plot, preserving exact natural keys', () => {
    expect(parseProjectInterestInput(piInput())).toEqual(piInput());
    const input = piInput({ projectName: ' โครงการ A ', plotId: 'แปลง A-01 ', reason: ' เหตุผล ' });
    expect(parseProjectInterestInput(input)).toEqual({ ...input, reason: 'เหตุผล' });
  });
  it.each([{ ownerUserId: piId(6) }, { command: 'book' }, { customerId: 'bad' }, { expectedCustomerRevision: null },
    { projectName: '' }, { plotId: '' }, { reason: ' ' }, { reason: 'x\n' }, { reason: '\ud800' }, { projectName: '\u0000' }, { plotId: '\t' },
    { projectName: 'ก'.repeat(201) }, { plotId: 'ก'.repeat(256) }, { reason: 'ก'.repeat(1001) }])('rejects missing/forged/invalid input %j', change => {
    expect(() => parseProjectInterestInput({ ...piInput(), ...change })).toThrow();
  });
  it('requires every command key and normalizes UUID casing only', () => {
    for (const key of Object.keys(piInput())) { const value: Record<string, unknown> = { ...piInput() }; delete value[key]; expect(() => parseProjectInterestInput(value)).toThrow(); }
    expect(parseProjectInterestInput(piInput({ customerId: piId(1).toUpperCase() })).customerId).toBe(piId(1));
  });
  it('bounds route scope and disallows ambiguous page query', () => {
    expect(parseProjectInterestsQuery(`https://local.invalid/?customerId=${piId(1)}`)).toEqual(piScope);
    expect(parseProjectInterestsScope(piScope)).toEqual(piScope);
    expect(parseProjectInterestsPageQuery({ customerId: piId(1) })).toBe(piId(1));
    for (const query of [{ customerId: [piId(1)] }, { customerId: piId(1), role: 'admin' }, {}]) expect(() => parseProjectInterestsPageQuery(query)).toThrow();
    for (const suffix of ['&customerId=bad', '&role=admin', '&page=-1', '&page=1.1', '&page=01', '&page=100001', '&page=1&page=1']) {
      expect(() => parseProjectInterestsQuery(`https://local.invalid/?customerId=${piId(1)}${suffix}`)).toThrow();
    }
  });
  it('checks result command identity and exact project/plot binding', () => {
    expect(parseProjectInterestResult(piResult(), piInput())).toEqual(piResult());
    for (const change of [{ requestId: piId(99) }, { customerId: piId(99) }, { projectName: 'other' }, { plotId: 'other' }, { replayed: 'yes' }, { interestId: null }, { ownerUserId: null }, { eventId: null }]) {
      expect(() => parseProjectInterestResult({ ...piResult(), ...change }, piInput())).toThrow();
    }
  });
  it('projects only allowed snapshot fields and bounds pages/options', () => {
    expect(parseProjectInterestsSnapshot({ ...piSnapshot(), secret: 'hidden' }, piScope)).toEqual(piSnapshot());
    for (const change of [{ page: 1 }, { projectsHasMore: true }, { hasMore: true }, { projects: null }, { interests: null }]) {
      expect(() => parseProjectInterestsSnapshot({ ...piSnapshot(), ...change }, piScope)).toThrow();
    }
    const value = piSnapshot(); value.customer.id = piId(99); expect(() => parseProjectInterestsSnapshot(value, piScope)).toThrow();
  });
  it('allows readonly Owner/other Sales/lost and rejects forged add rights', () => {
    for (const role of ['owner', 'other', 'lost'] as const) {
      const value = piSnapshot();
      if (role === 'owner') value.actor.role = 'owner'; else if (role === 'other') value.actor.userId = piId(99); else value.customer.intakeStatus = 'lost';
      expect(() => parseProjectInterestsSnapshot(value, piScope)).toThrow();
      value.customer.canAdd = false; expect(parseProjectInterestsSnapshot(value, piScope)).toEqual(value);
    }
  });
  it('supports each known intake state including historical unknown, without inventing a state', () => {
    for (const status of ['new', 'contacted', 'following_up', 'nurture', 'lost', 'legacy_unclassified']) {
      const value = piSnapshot(); value.customer.intakeStatus = status; value.customer.canAdd = false;
      expect(parseProjectInterestsSnapshot(value, piScope).customer.intakeStatus).toBe(status);
    }
  });
  it('rejects duplicate identity/project options and already-listed interests', () => {
    const value = piSnapshot(); value.projects.push(value.projects[0]); expect(() => parseProjectInterestsSnapshot(value, piScope)).toThrow();
    value.projects.pop(); value.interests.push({ id: piId(4), projectName: value.projects[0].name, ownerUserId: piId(6), revision: piId(5), status: 'lost', plotId: null });
    expect(() => parseProjectInterestsSnapshot(value, piScope)).toThrow();
    value.projects = []; expect(parseProjectInterestsSnapshot(value, piScope)).toEqual(value);
    value.interests.push(value.interests[0]); expect(() => parseProjectInterestsSnapshot(value, piScope)).toThrow();
  });
});
