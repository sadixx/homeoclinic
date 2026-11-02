// Verified Indian homoeopathic registering authorities offered by the S01
// setup wizard's registration-council dropdown (HC-MVP1-M3set).
//
// Source (state boards/councils): Ministry of AYUSH reply to Rajya Sabha
// Unstarred Question No. 1768 dated 02.08.2022, Annexure II "State-wise State
// Homeopathic Boards/Councils". National registers: National Commission for
// Homoeopathy Act, 2020 (Board of Ethics and Registration for Homoeopathy) and
// the Homoeopathy Central Council Act, 1973 (Central Council of Homoeopathy,
// superseded by the NCH Act 2020; kept for doctors registered before 2020).
//
// Himachal Pradesh is intentionally EXCLUDED: the official list gives only an
// address, not the authority's name. States/UTs with no board in the same
// source (Manipur, Mizoram, Sikkim, DNH&DD, A&N, Puducherry, Ladakh,
// Lakshadweep) use the wizard's "Other" option. Odisha and Rajasthan wording
// is kept exactly as the Ministry reported it.
//
// Institution names are proper-noun DATA, not UI copy, so they live here and
// not in locales/en.json (R-UI-007 covers the control's own copy only).
// Record of the list: docs/reference/registration-councils.md.

/** One registering authority: the state/UT (or national scope) and its name. */
export interface RegistrationCouncil {
  /** State / UT, or `National` / `National (legacy)` for the central registers. */
  readonly state: string;
  /** Official name of the registering authority. */
  readonly authority: string;
}

/** Display label stored in the doctor profile: `<State>: <Authority>`. */
export function councilLabel(council: RegistrationCouncil): string {
  return `${council.state}: ${council.authority}`;
}

/**
 * Label format used before M3-RWv6 (`<State> \u2014 <Authority>`). Profiles
 * saved then still hold it, so it is matched on re-open and mapped to the
 * current label. Never shown or stored for new selections.
 */
function legacyCouncilLabel(council: RegistrationCouncil): string {
  return `${council.state} \u2014 ${council.authority}`;
}

/** The verified list, in display order. */
export const REGISTRATION_COUNCILS: readonly RegistrationCouncil[] = [
  {
    state: 'Andhra Pradesh',
    authority: 'Andhra Boards for Ayurveda and Homoeopathy',
  },
  {
    state: 'Arunachal Pradesh',
    authority: 'Arunachal Pradesh Homoeopathy Council',
  },
  {
    state: 'Assam',
    authority: 'Board of Homoeopathic System of Medicine, Assam',
  },
  { state: 'Bihar', authority: 'Bihar Homoeopathic Board of Medicine' },
  {
    state: 'Chandigarh (UT)',
    authority: 'Council of Homoeopathic System of Medicine, Chandigarh',
  },
  {
    state: 'Chhattisgarh',
    authority: 'State Council of Homoeopathy, Chhattisgarh',
  },
  {
    state: 'Delhi',
    authority: 'Board of Homoeopathic System of Medicine, Delhi',
  },
  {
    state: 'Goa',
    authority: 'Goa Board of Indian System of Medicine & Homoeopathy',
  },
  {
    state: 'Gujarat',
    authority: 'Council of Homoeopathic System of Medicine, Gujarat State',
  },
  {
    state: 'Haryana',
    authority: 'Council of Homoeopathic System of Medicine, Haryana',
  },
  {
    state: 'Jammu & Kashmir',
    authority: 'Jammu & Kashmir Board of Homoeopathic System of Medicine',
  },
  { state: 'Jharkhand', authority: 'Jharkhand State AYUSH Medical Council' },
  {
    state: 'Karnataka',
    authority: 'Karnataka Board of Homoeopathic System of Medicine',
  },
  { state: 'Kerala', authority: 'Kerala State Medical Council' },
  {
    state: 'Madhya Pradesh',
    authority: 'State Council of Homoeopathy, Madhya Pradesh',
  },
  { state: 'Maharashtra', authority: 'Maharashtra Council of Homoeopathy' },
  {
    state: 'Meghalaya',
    authority: 'Board of Homoeopathic Medicine, Meghalaya',
  },
  {
    state: 'Nagaland',
    authority: 'Board of Homoeopathic System of Medicine, Nagaland',
  },
  {
    state: 'Odisha',
    authority: 'Directorate of AYUSH, Odisha (registering authority)',
  },
  {
    state: 'Punjab',
    authority: 'Council of Homoeopathic System of Medicine, Punjab',
  },
  {
    state: 'Rajasthan',
    authority: 'Rajasthan Board of Homoeopathic Chikitsa Board',
  },
  { state: 'Tamil Nadu', authority: 'Tamil Nadu Homoeopathic Medical Council' },
  { state: 'Telangana', authority: 'Boards of Indian Medicines, Telangana' },
  { state: 'Tripura', authority: 'Council of Homoeopathic Medicine, Tripura' },
  {
    state: 'Uttar Pradesh',
    authority: 'Homoeopathic Medicine Board, Uttar Pradesh',
  },
  {
    state: 'Uttarakhand',
    authority: 'Homoeopathic Medicine Board, Uttarakhand',
  },
  {
    state: 'West Bengal',
    authority: 'Council of Homoeopathic Medicine, West Bengal',
  },
  {
    state: 'National',
    authority: 'National Commission for Homoeopathy (National Register)',
  },
  {
    state: 'National (legacy)',
    authority: 'Central Council of Homoeopathy (pre-2020)',
  },
];

/** Display labels of the verified list, in order. */
export const REGISTRATION_COUNCIL_LABELS: readonly string[] =
  REGISTRATION_COUNCILS.map(councilLabel);

/**
 * Split a stored council string into the dropdown state that re-opens it:
 * a listed label selects that option (a pre-RWv6 em-dash label selects the
 * same option under its current label); any other non-empty value re-opens as
 * "Other" with the text preserved; empty selects nothing.
 */
export function councilSelectionFor(stored: string): {
  readonly choice: 'listed' | 'other' | 'none';
  readonly text: string;
} {
  if (stored === '') return { choice: 'none', text: '' };
  if (REGISTRATION_COUNCIL_LABELS.includes(stored)) {
    return { choice: 'listed', text: stored };
  }
  const legacy = REGISTRATION_COUNCILS.find(
    (c) => legacyCouncilLabel(c) === stored,
  );
  if (legacy !== undefined) {
    return { choice: 'listed', text: councilLabel(legacy) };
  }
  return { choice: 'other', text: stored };
}
