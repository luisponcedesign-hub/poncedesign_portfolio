#!/usr/bin/env python3
"""Write data/active-users.json from Google Analytics.

The contact section's "Active users" card reads that file. The page is
static and can't hold API credentials, so this runs on a schedule in
GitHub Actions (.github/workflows/active-users.yml) and commits the result.

Users over the last 30 complete days, compared with the 30 days before.
The longer window smooths out day-to-day swings. Also lists users per
country (ISO alpha-2) over the same 30 days for the "Countries" map card.

Needs `pip install google-analytics-data` and Google credentials for an
account with Viewer access to the property. In Actions those come from
google-github-actions/auth; locally, `gcloud auth application-default login`.
"""
import json
import os
from datetime import datetime, timezone

from google.analytics.data_v1beta import BetaAnalyticsDataClient
from google.analytics.data_v1beta.types import DateRange, Dimension, Metric, RunReportRequest

PROPERTY = os.environ.get('GA_PROPERTY_ID', '554579350')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'active-users.json')


def main():
    client = BetaAnalyticsDataClient()
    report = client.run_report(RunReportRequest(
        property=f'properties/{PROPERTY}',
        metrics=[Metric(name='activeUsers')],
        date_ranges=[
            DateRange(start_date='30daysAgo', end_date='yesterday', name='current'),
            DateRange(start_date='60daysAgo', end_date='31daysAgo', name='previous'),
        ],
    ))

    # With two ranges GA adds a dateRange dimension; rows with no users are omitted.
    totals = {'current': 0, 'previous': 0}
    for row in report.rows:
        totals[row.dimension_values[0].value] = int(row.metric_values[0].value)

    by_country = client.run_report(RunReportRequest(
        property=f'properties/{PROPERTY}',
        dimensions=[Dimension(name='countryId')],
        metrics=[Metric(name='activeUsers')],
        date_ranges=[DateRange(start_date='30daysAgo', end_date='yesterday')],
    ))
    # '(not set)' and friends aren't two-letter codes; the map can't place them.
    countries = {
        row.dimension_values[0].value: int(row.metric_values[0].value)
        for row in by_country.rows
        if len(row.dimension_values[0].value) == 2
    }

    cur, prev = totals['current'], totals['previous']
    data = {
        'value': cur,
        'change': round((cur - prev) / prev * 100, 1) if prev else None,
        'countries': dict(sorted(countries.items(), key=lambda kv: -kv[1])),
        'period': 'last 30 days',
        'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
    }
    with open(OUT, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    print(json.dumps(data))


if __name__ == '__main__':
    main()
