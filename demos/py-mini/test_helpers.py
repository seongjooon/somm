import unittest
from helpers import total, average, format_price


class HelpersTest(unittest.TestCase):
    def test_total(self):
        self.assertEqual(total([]), 0)
        self.assertEqual(total([-2, 3]), 1)

    def test_average(self):
        self.assertEqual(average([]), 0)
        self.assertEqual(average([2, 4]), 3)

    def test_price(self):
        self.assertEqual(format_price(1.5), "$1.50")
