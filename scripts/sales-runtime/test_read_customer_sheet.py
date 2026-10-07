"""Synthetic-only tests. Temporary workbooks contain no real customer data."""
from datetime import datetime
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

from openpyxl import Workbook

spec = importlib.util.spec_from_file_location("customer_sheet", Path(__file__).with_name("read-customer-sheet.py"))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="buildtrack-synthetic-sheet-")
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "synthetic.xlsx"
        book = Workbook()
        sheet = book.active
        sheet.title = "ข้อมูลลูกค้า"
        sheet.append([f"HEADER {i}" for i in range(17)])
        sheet["A2"] = datetime(2026, 7, 25)
        sheet["B2"] = datetime(2026, 7, 26, 14, 30)
        sheet["C2"] = "SYNTHETIC ONLY"
        sheet["G2"] = "=1+1"
        sheet["M2"] = 0
        sheet.row_dimensions[2].hidden = True
        sheet["G4"] = "=1+1"
        book.save(self.path)
        book.close()
        self.original = self.path.read_bytes()
        self.sha256 = hashlib.sha256(self.original).hexdigest()

    def test_hidden_empty_and_formula_rows_are_preserved_without_writing(self):
        data = reader.extract(self.path, self.sha256, "2026-09-28")
        self.assertEqual(data["maxRow"], 4)
        self.assertEqual([r["rowNumber"] for r in data["rows"]], [2, 3, 4])
        self.assertTrue(data["rows"][0]["hidden"])
        self.assertEqual(data["rows"][0]["formulaColumns"], [6])
        self.assertEqual(data["rows"][1]["values"], [None] * 17)
        self.assertEqual(data["rows"][2]["formulaColumns"], [6])
        self.assertEqual(self.path.read_bytes(), self.original)

    def test_typed_dates_and_zero_do_not_get_silently_coerced(self):
        values = reader.extract(self.path, self.sha256, "2026-09-28")["rows"][0]["values"]
        self.assertEqual(values[0], "2026-07-25")
        self.assertEqual(values[1], "2026-07-26T14:30:00")
        self.assertEqual(values[12], 0)
        self.assertIsNone(values[11])

    def test_hash_change_blocks_extraction(self):
        with self.assertRaisesRegex(ValueError, "SOURCE_HASH_CHANGED"):
            reader.extract(self.path, "0" * 64, "2026-09-28")

    def test_malformed_hash_blocks_extraction(self):
        with self.assertRaisesRegex(ValueError, "SOURCE_HASH_REQUIRED"):
            reader.extract(self.path, "bad", "2026-09-28")

    def test_invalid_date_blocks_extraction(self):
        with self.assertRaises(ValueError):
            reader.extract(self.path, self.sha256, "2026-02-30")


if __name__ == "__main__":
    unittest.main()
