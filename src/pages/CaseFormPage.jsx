import React, { useEffect, useState } from 'react';
import { doc, getDoc, setDoc, serverTimestamp, collection } from 'firebase/firestore';
import { useAuth, db, FirestorePaths, Input, Textarea, Button, useRoute } from '../AppCore';

export default function CaseFormPage({ params }) {
  const caseId = params?.caseId;
  const { currentUser } = useAuth();
  const { navigate } = useRoute();
  const [form, setForm] = useState({ caseName: '', visibleToUserIds: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!caseId) { setLoading(false); return; }
    async function load() {
      try {
        const snap = await getDoc(doc(db, FirestorePaths.CASE_DOCUMENT(caseId)));
        if (snap.exists()) {
          const d = snap.data();
          setForm({ caseName: d.caseName || '', visibleToUserIds: (d.visibleToUserIds || []).join(',') });
        }
      } catch (err) {
        console.error('Failed to load case', err);
      }
      setLoading(false);
    }
    load();
  }, [caseId]);

  const handleChange = e => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async e => {
    e.preventDefault();
    const data = {
      caseName: form.caseName,
      disbursements: [],
      invoiceMappings: [],
      visibleToUserIds: form.visibleToUserIds.split(',').map(s => s.trim()).filter(Boolean),
      updatedAt: serverTimestamp(),
      _deleted: false,
    };
    try {
      if (caseId) {
        const snap = await getDoc(doc(db, FirestorePaths.CASE_DOCUMENT(caseId)));
        if (snap.exists()) {
          const existing = snap.data();
          await setDoc(doc(db, FirestorePaths.CASE_DOCUMENT(caseId)), { ...existing, ...data }, { merge: true });
        }
      } else {
        const newDocRef = doc(collection(db, FirestorePaths.CASES_COLLECTION()));
        await setDoc(newDocRef, { ...data, createdBy: currentUser.uid, createdAt: serverTimestamp() });
      }
      navigate('/admin/dashboard');
    } catch (err) {
      console.error('Failed to save case', err);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
      <div>
        <label className="block text-sm font-medium mb-1">Case Name</label>
        <Input name="caseName" value={form.caseName} onChange={handleChange} required />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Visible To User IDs (comma separated)</label>
        <Textarea name="visibleToUserIds" value={form.visibleToUserIds} onChange={handleChange} rows={3} />
      </div>
      <Button type="submit">{caseId ? 'Update Case' : 'Create Case'}</Button>
    </form>
  );
}
