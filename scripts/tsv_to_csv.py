#!/usr/bin/env python3
"""Read tab-separated lines from stdin; output RFC 4180 CSV to stdout.
Handles fields that contain commas, newlines, or double quotes."""
import csv
import sys

def main():
    reader = csv.reader(sys.stdin, delimiter="\t", quoting=csv.QUOTE_MINIMAL)
    writer = csv.writer(sys.stdout, lineterminator="\n")
    for row in reader:
        writer.writerow(row)

if __name__ == "__main__":
    main()
