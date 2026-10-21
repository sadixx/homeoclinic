// Patients route container (docs/ui/S05 + S06 + S07; CODE-LAYOUT patients/
// module). Owns the view switching between the patient list (S05), the
// register / edit form (S06) and the single-patient dashboard (S07). It holds
// no data of its own: each child consumes ONLY the typed bindings. This is the
// `/patients` route shell the app shell mounts.

import { useCallback, useState } from 'react';

import { PatientDashboard } from './PatientDashboard';
import { PatientForm } from './PatientForm';
import { PatientList } from './PatientList';

/** Which patients sub-view is visible. */
type View =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'edit'; patientId: string }
  | { kind: 'dashboard'; patientId: string };

export interface PatientsPageProps {
  /** Deep-link straight to a patient's dashboard (S07). */
  readonly initialPatientId?: string;
  /** Open on the list (default) or straight into the register form. */
  readonly initialView?: 'list' | 'new';
}

/** The `/patients` container. */
export function PatientsPage({
  initialPatientId,
  initialView = 'list',
}: PatientsPageProps): JSX.Element {
  const [view, setView] = useState<View>(() => {
    if (initialPatientId !== undefined) {
      return { kind: 'dashboard', patientId: initialPatientId };
    }
    return initialView === 'new' ? { kind: 'new' } : { kind: 'list' };
  });

  const openDashboard = useCallback((patientId: string): void => {
    setView({ kind: 'dashboard', patientId });
  }, []);

  const openList = useCallback((): void => {
    setView({ kind: 'list' });
  }, []);

  const openNew = useCallback((): void => {
    setView({ kind: 'new' });
  }, []);

  const openEdit = useCallback((patientId: string): void => {
    setView({ kind: 'edit', patientId });
  }, []);

  switch (view.kind) {
    case 'list':
      return (
        <PatientList onOpenPatient={openDashboard} onNewPatient={openNew} />
      );

    case 'new':
      return (
        <PatientForm
          mode="new"
          onSaved={(patientId) => openDashboard(patientId)}
          onOpenExisting={openDashboard}
          onCancel={openList}
        />
      );

    case 'edit':
      return (
        <PatientForm
          mode="edit"
          patientId={view.patientId}
          onSaved={(patientId) => openDashboard(patientId)}
          onCancel={() => openDashboard(view.patientId)}
        />
      );

    case 'dashboard':
      return (
        <PatientDashboard
          patientId={view.patientId}
          onOpenPatient={openDashboard}
          onEdit={openEdit}
          onBack={openList}
        />
      );
  }
}
