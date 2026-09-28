import { useOutletContext } from 'react-router-dom';
import { FormEvent, useState } from 'react';
import { activateIdentity, fetchPendingOnboarding, requestOnboarding } from '../../api';
import { AsyncSection, Button, DataTable, InlineNotice, PageHeader, useLoader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Verification() {
  const { role } = useOutletContext<PortalContext>();
  const { data, loading, error, reload } = useLoader(() => fetchPendingOnboarding(role), [role]);
  const [subjectDID, setSubjectDID] = useState('');
  const [orgUnit, setOrgUnit] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      await requestOnboarding(role, subjectDID.trim(), orgUnit.trim());
      setNotice({ ok: true, message: `Onboarding requested for ${subjectDID}.` });
      setSubjectDID('');
      setOrgUnit('');
      reload();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  async function activate(did: string) {
    setBusy(did);
    try {
      await activateIdentity(role, did);
      reload();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader title="Identity Verification" subtitle="Review new onboarding requests and activate them onto the ledger." />

      <section className="panel-section">
        <h2>Request onboarding for a new DID</h2>
        <form className="inline-form" onSubmit={submit}>
          <input
            className="text-input mono"
            placeholder="did:fabric:… (subject DID)"
            value={subjectDID}
            onChange={(e) => setSubjectDID(e.target.value)}
            required
          />
          <input
            className="text-input"
            placeholder="Org unit (e.g. Ghaziabad)"
            value={orgUnit}
            onChange={(e) => setOrgUnit(e.target.value)}
            required
          />
          <Button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Request onboarding'}</Button>
        </form>
        {notice && <InlineNotice ok={notice.ok} message={notice.message} />}
      </section>

      <section className="panel-section">
        <h2>Pending requests</h2>
        <AsyncSection loading={loading} error={error} empty={(data || []).length === 0} emptyLabel="No identities are awaiting verification.">
          <DataTable
            columns={[
              { key: 'did', label: 'DID', mono: true, render: (d) => d.did.replace('did:fabric:', '') },
              { key: 'orgUnit', label: 'Org Unit' },
              { key: 'createdAt', label: 'Requested' },
              {
                key: 'actions',
                label: 'Actions',
                render: (d) => (
                  <Button variant="ghost" disabled={busy === d.did} onClick={() => activate(d.did)}>
                    {busy === d.did ? 'Activating…' : 'Activate'}
                  </Button>
                ),
              },
            ]}
            rows={data || []}
            rowKey={(d) => d.did}
          />
        </AsyncSection>
      </section>
    </div>
  );
}
