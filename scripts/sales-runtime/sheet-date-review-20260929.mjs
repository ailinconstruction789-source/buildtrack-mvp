// User-confirmed on 2026-09-29. Applies only to this downloaded snapshot.
// Never edit the workbook or reuse these row numbers on another revision.
export const reviewedSheetDates = {
    sourceSha256: '37b4cfa1e3b444261b83fe4d0b9c12792fe47d0f244db7d456a04abf2d1be1bf',
    decisions: [
        { rowNumber: 885, columnIndex: 0, expectedValue: '2569-07-25', correctedDate: '2026-07-25',
            reason: 'Buddhist year stored as Gregorian year; user confirmed intended date.',
            decisionRef: 'user-confirmation-2026-09-29-A885' },
        { rowNumber: 933, columnIndex: 1, expectedValue: '26 กย 26', correctedDate: '2026-09-26',
            reason: 'User confirmed the intended date of the textual booking date.',
            decisionRef: 'user-confirmation-2026-09-29-B933' },
    ],
};
