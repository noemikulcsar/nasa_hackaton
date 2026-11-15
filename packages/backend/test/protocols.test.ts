import { describe, expect, it } from 'vitest';
import { loadProtocols, validateProtocol } from '../src/protocols';

describe('protocol library', () => {
  it('loads the demo protocols without rejections', () => {
    const { protocols, rejected } = loadProtocols();
    expect(protocols.length).toBe(6);
    expect(rejected).toEqual([]);
  });
  it('rejects dose instructions in an unapproved protocol', () => {
    const p = { ...loadProtocols().protocols[0] };
    p.sections = [...p.sections, { id: '9', heading: 'Test', body: 'Administer 50 mg.' }];
    expect(validateProtocol(p)).toMatch(/medicine or dose/);
    expect(validateProtocol({ ...loadProtocols().protocols[0], medication: { approvedText: 'x' } })).toMatch(/not approved/);
  });
});
