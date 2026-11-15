/** A protocol from the on-board library, shown word for word (never rewritten by the console or the AI). */
export default function ProtocolText({ protocol: p, highlight, compact }) {
  return (
    <div className="protocol-text" data-testid="protocol-text" data-protocol-id={p.id}>
      <p className="protocol-meta">
        <b>{p.title}</b>
        <span>{p.id}, version {p.version}, {p.date}{p.approval.approvedForMission ? `, approved by ${p.approval.approvedBy}` : ''}</span>
      </p>
      {!p.approval.approvedForMission && <p className="protocol-warn">Fictional demo protocol, not approved for clinical use.</p>}
      {p.sections.filter((s) => !compact || s.id === highlight || /step/i.test(s.heading)).map((s) => (
        <div key={s.id} className={`protocol-sec ${s.id === highlight ? 'hl' : ''}`}>
          <h4>{s.id}. {s.heading}</h4>
          <div className="verbatim">{s.body}</div>
        </div>
      ))}
      {p.medication && p.approval.approvedForMission
        ? <div className="protocol-sec"><h4>Medicines</h4><pre className="verbatim">{p.medication.approvedText}</pre></div>
        : <p className="note">No medicine instructions: these are shown only from a protocol approved for the mission, exactly as approved.</p>}
    </div>
  );
}

/** Protocols that cover a body region, best match first (rules active in the region named in the protocol text). */
export function protocolsForRegion(protocols, region) {
  const rules = region.reasons.map((r) => r.rule);
  return protocols
    .filter((p) => p.regions.includes(region.id))
    .map((p) => {
      const text = JSON.stringify(p.sections);
      return { p, score: rules.filter((r) => text.includes(r)).length * 10 + region.reasons.filter((r) => p.keywords.some((k) => r.title.toLowerCase().includes(k))).length };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);
}
