# Google Search Console MCP Server

A Model Context Protocol (MCP) server providing comprehensive access to Google Search Console data with enhanced analytics capabilities.

## Features

- **Enhanced Search Analytics**: Retrieve up to 25,000 rows of performance data
- **Advanced Filtering**: Support for regex patterns and multiple filter operators
- **Quick Wins Detection**: Automatically identify optimization opportunities
- **Rich Dimensions**: Query, page, country, device, and search appearance analysis
- **Flexible Date Ranges**: Customizable reporting periods with historical data access

### Sponsored by

<a href="https://macuse.app?ref=mcp-server-gsc">
    <img src="https://macuse.app/logo-pill.png" width="200" alt="macuse.app">
</a>

[macuse.app](https://macuse.app) is a native macOS application that gives your AI superpowers by integrating AI assistants with macOS apps like Calendar, Mail, and Notes, plus universal UI control for any application. Supports Claude Desktop, Cursor, and Raycast with one-click setup. Privacy-first, runs locally.

## Prerequisites

- Node.js 18 or later
- Google Cloud Project with Search Console API enabled
- Service Account credentials with Search Console access

## Installation

```bash
npm install mcp-server-gsc
```

## Authentication Setup

To obtain Google Search Console API credentials:

1. Visit the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the API:

- Go to "APIs & Services" > "Library"
- Search for and enable ["Search Console API"](https://console.cloud.google.com/marketplace/product/google/searchconsole.googleapis.com)

4. Create credentials:

- Navigate to ["APIs & Services" > "Credentials"](https://console.cloud.google.com/apis/credentials)
- Click "Create Credentials" > "Service Account"
- Fill in the service account details
- Create a new key in JSON format
- The credentials file (.json) will download automatically

5. Grant access:

- Open Search Console
- Add the service account email (format: name@project.iam.gserviceaccount.com) as a property administrator

## Usage

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "gsc": {
      "command": "npx",
      "args": ["-y", "mcp-server-gsc"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/path/to/credentials.json"
      }
    }
  }
}
```

## Available Tools

### search_analytics

Get comprehensive search performance data from Google Search Console with enhanced analytics capabilities.

**Required Parameters:**

- `siteUrl`: Site URL (format: `http://www.example.com/` or `sc-domain:example.com`)
- `startDate`: Start date (YYYY-MM-DD)
- `endDate`: End date (YYYY-MM-DD)

**Optional Parameters:**

- `dimensions`: Comma-separated list (`query`, `page`, `country`, `device`, `searchAppearance`, `date`)
- `type`: Search type (`web`, `image`, `video`, `news`, `discover`, `googleNews`)
- `aggregationType`: Aggregation method (`auto`, `byNewsShowcasePanel`, `byProperty`, `byPage`)
- `rowLimit`: Maximum rows to return (default: 1000, max: 25000)
- `dataState`: Data freshness (`all` or `final`, default: `final`)

**Filter Parameters:**

- `pageFilter`: Filter by page URL (supports regex with `regex:` prefix)
- `queryFilter`: Filter by search query (supports regex with `regex:` prefix)
- `countryFilter`: Filter by country ISO 3166-1 alpha-3 code (e.g., `USA`, `CHN`)
- `deviceFilter`: Filter by device type (`DESKTOP`, `MOBILE`, `TABLET`)
- `searchAppearanceFilter`: Filter by search feature (e.g., `AMP_BLUE_LINK`, `AMP_TOP_STORIES`)
- `filterOperator`: Operator for filters (`equals`, `contains`, `notEquals`, `notContains`, `includingRegex`, `excludingRegex`)

**Quick Wins Detection:**

- `detectQuickWins`: Enable automatic detection of optimization opportunities (default: `false`)
- `quickWinsConfig`: Configuration for quick wins detection:
  - `positionRange`: Position range to consider (default: `[4, 20]`)
  - `minImpressions`: Minimum impressions threshold (default: `100`)
  - `minCtr`: Minimum CTR percentage (default: `1`)

**Example - Basic Query:**

```json
{
  "siteUrl": "https://example.com",
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "dimensions": "query,page",
  "rowLimit": 5000
}
```

**Example - Advanced Filtering with Regex:**

```json
{
  "siteUrl": "https://example.com",
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "dimensions": "page,query",
  "queryFilter": "regex:(AI|machine learning|ML)",
  "filterOperator": "includingRegex",
  "deviceFilter": "MOBILE",
  "rowLimit": 10000
}
```

**Example - Quick Wins Detection:**

```json
{
  "siteUrl": "https://example.com",
  "startDate": "2024-01-01",
  "endDate": "2024-01-31",
  "dimensions": "query,page",
  "detectQuickWins": true,
  "quickWinsConfig": {
    "positionRange": [4, 15],
    "minImpressions": 500,
    "minCtr": 2
  }
}
```

### submit_sitemap

Submits or resubmits a sitemap. Resubmitting after a deploy is how Google learns that `<lastmod>` dates changed. The server requests the `webmasters` scope, so this works when the service account has **Full** or **Owner** permission on the property; a Restricted account can still use every read tool.

```json
{ "siteUrl": "sc-domain:example.com", "feedpath": "https://example.com/sitemap.xml" }
```

### inspect_batch

Runs the URL Inspection API over many URLs and returns a summary: counts by coverage state (indexed, crawled or discovered but not indexed, unknown to Google), the URLs that are not indexed, canonical mismatches and per-URL errors, then one row per URL. Takes URLs from `urls`, from `sitemapUrl`, or from the sitemap entries whose `<lastmod>` is on or after `lastmodOnOrAfter`. Read-only. `limit` (default 50, max 200) and `concurrency` (default 3) keep it inside the inspection quota of 2,000 a day and 600 a minute per property.

**Example: check every page changed in today's deploy**

```json
{
  "siteUrl": "sc-domain:example.com",
  "sitemapUrl": "https://example.com/sitemap.xml",
  "lastmodOnOrAfter": "2026-10-29",
  "limit": 200
}
```

### indexnow_submit

Notifies the IndexNow engines (Bing, Yandex, Seznam, Naver and others; not Google) that URLs were added, changed or removed. Takes URLs the same way as `inspect_batch`. Needs the site's IndexNow key, which is public by design: the engines check it against `https://{host}/{key}.txt`. Every URL must be on `host`. It does not use the Google credentials.

```json
{
  "host": "example.com",
  "key": "your-indexnow-key",
  "sitemapUrl": "https://example.com/sitemap.xml",
  "lastmodOnOrAfter": "2026-10-29"
}
```

**After a deploy:** `submit_sitemap` for each sitemap, then `indexnow_submit` with `lastmodOnOrAfter` set to the deploy date, then `inspect_batch` a few days later to see what was picked up. There is no API for Search Console's Request Indexing button; Google's Indexing API only accepts job-posting and livestream pages.

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.
