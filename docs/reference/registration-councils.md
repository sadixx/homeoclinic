# Registration councils (S01 setup wizard)

Reference for the registration-council dropdown in the first-run setup wizard,
Step 1 Doctor profile (HC-MVP1-M3set). The data lives in
`apps/desktop/src/setup/registrationCouncils.ts`. The control's own copy (the
label, the "Other (type manually)" option, the Other box label and placeholder,
and the required error) lives in `apps/desktop/src/locales/en.json`.

## Source

- State boards and councils: Ministry of AYUSH reply to Rajya Sabha Unstarred
  Question No. 1768, dated 02.08.2022, Annexure II "State-wise State
  Homeopathic Boards/Councils".
- National register: National Commission for Homoeopathy Act, 2020 (Board of
  Ethics and Registration for Homoeopathy).
- National legacy register: Homoeopathy Central Council Act, 1973 (Central
  Council of Homoeopathy). The NCH Act 2020 replaced it. It is kept so doctors
  registered before 2020 can pick it.

Odisha and Rajasthan are worded exactly as the Ministry reported them.

## List

Each label has the form `<State>: <Authority>`, for example
`Maharashtra: Maharashtra Council of Homoeopathy`. Labels contain no em or en
dash. The options appear in this order, followed by "Other (type manually)".

| # | State / scope | Authority |
|---|---|---|
| 1 | Andhra Pradesh | Andhra Boards for Ayurveda and Homoeopathy |
| 2 | Arunachal Pradesh | Arunachal Pradesh Homoeopathy Council |
| 3 | Assam | Board of Homoeopathic System of Medicine, Assam |
| 4 | Bihar | Bihar Homoeopathic Board of Medicine |
| 5 | Chandigarh (UT) | Council of Homoeopathic System of Medicine, Chandigarh |
| 6 | Chhattisgarh | State Council of Homoeopathy, Chhattisgarh |
| 7 | Delhi | Board of Homoeopathic System of Medicine, Delhi |
| 8 | Goa | Goa Board of Indian System of Medicine & Homoeopathy |
| 9 | Gujarat | Council of Homoeopathic System of Medicine, Gujarat State |
| 10 | Haryana | Council of Homoeopathic System of Medicine, Haryana |
| 11 | Jammu & Kashmir | Jammu & Kashmir Board of Homoeopathic System of Medicine |
| 12 | Jharkhand | Jharkhand State AYUSH Medical Council |
| 13 | Karnataka | Karnataka Board of Homoeopathic System of Medicine |
| 14 | Kerala | Kerala State Medical Council |
| 15 | Madhya Pradesh | State Council of Homoeopathy, Madhya Pradesh |
| 16 | Maharashtra | Maharashtra Council of Homoeopathy |
| 17 | Meghalaya | Board of Homoeopathic Medicine, Meghalaya |
| 18 | Nagaland | Board of Homoeopathic System of Medicine, Nagaland |
| 19 | Odisha | Directorate of AYUSH, Odisha (registering authority) |
| 20 | Punjab | Council of Homoeopathic System of Medicine, Punjab |
| 21 | Rajasthan | Rajasthan Board of Homoeopathic Chikitsa Board |
| 22 | Tamil Nadu | Tamil Nadu Homoeopathic Medical Council |
| 23 | Telangana | Boards of Indian Medicines, Telangana |
| 24 | Tripura | Council of Homoeopathic Medicine, Tripura |
| 25 | Uttar Pradesh | Homoeopathic Medicine Board, Uttar Pradesh |
| 26 | Uttarakhand | Homoeopathic Medicine Board, Uttarakhand |
| 27 | West Bengal | Council of Homoeopathic Medicine, West Bengal |
| 28 | National | National Commission for Homoeopathy (National Register) |
| 29 | National (legacy) | Central Council of Homoeopathy (pre-2020) |

## Exclusions

- Himachal Pradesh is left out on purpose. The official list gives only an
  address for it, not the authority's name, so the name cannot be confirmed.
  Doctors registered there use Other.

## States and UTs with no board in the source

The same source lists no homoeopathic board for these. Doctors there use
Other and type the council name:

- Manipur
- Mizoram
- Sikkim
- Dadra & Nagar Haveli and Daman & Diu
- Andaman & Nicobar Islands
- Puducherry
- Ladakh
- Lakshadweep

## Storage

No schema, migration or binding change. The doctor profile's existing
`regCouncil` string stores the chosen label as shown, or the trimmed text
typed for Other. A value saved before M3-RWv6 in the old form
`<State> \u2014 <Authority>` (state, space, em dash, space, authority) re-opens as
the same listed option, shown and saved again under its current
`<State>: <Authority>` label. Any other stored value that is not in the list
re-opens as Other, with the text kept.
