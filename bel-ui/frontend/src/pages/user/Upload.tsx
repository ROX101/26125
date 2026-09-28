import { useOutletContext } from 'react-router-dom';
import { FormEvent, useState } from 'react';
import { uploadAsset } from '../../api';
import { Button, InlineNotice, PageHeader } from '../../components/common';
import { PortalContext } from '../../PortalLayout';

export default function Upload() {
  const { role, roleConfig } = useOutletContext<PortalContext>();
  const [file, setFile] = useState<File | null>(null);
  const [orgScope, setOrgScope] = useState(roleConfig.orgScope === '*' ? '' : roleConfig.orgScope);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await uploadAsset(role, file, orgScope.trim());
      setNotice({ ok: true, message: `Uploaded as ${result.assetId} (SHA-256 ${result.sha256Hash.slice(0, 16)}…). Awaiting approval.` });
      setFile(null);
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader title="Upload Asset" subtitle="The file's bytes stay on this server — only its SHA-256 hash and metadata go on-chain." />
      <section className="panel-section">
        <form className="stacked-form" onSubmit={submit}>
          <input
            className="text-input"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            required
          />
          <input
            className="text-input"
            placeholder="Org scope (e.g. Ghaziabad)"
            value={orgScope}
            onChange={(e) => setOrgScope(e.target.value)}
            required
          />
          <Button type="submit" disabled={submitting || !file}>{submitting ? 'Uploading…' : 'Upload'}</Button>
        </form>
        {notice && <InlineNotice ok={notice.ok} message={notice.message} />}
      </section>
    </div>
  );
}
