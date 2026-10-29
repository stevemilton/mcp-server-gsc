import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  GetSitemapSchema,
  IndexInspectSchema,
  ListSitemapsSchema,
  SearchAnalyticsSchema,
  EnhancedSearchAnalyticsSchema,
  QuickWinsDetectionSchema,
  SubmitSitemapSchema,
  InspectBatchSchema,
  IndexNowSubmitSchema,
} from './schemas.js';
import { z } from 'zod';
import { SearchConsoleService } from './search-console.js';
import { fetchSitemapUrls } from './sitemap.js';
import { submitIndexNow } from './indexnow.js';

/** URLs from an explicit list and/or a sitemap (filtered by lastmod), de-duplicated in order. */
async function resolveUrls(args: { urls?: string[]; sitemapUrl?: string; lastmodOnOrAfter?: string }): Promise<string[]> {
  const fromSitemap = args.sitemapUrl
    ? (await fetchSitemapUrls(args.sitemapUrl, args.lastmodOnOrAfter)).map((e) => e.loc)
    : [];
  return [...new Set([...(args.urls ?? []), ...fromSitemap])];
}

export function createServer(credentials: string): Server {
  if (!credentials) {
    throw new Error('credentials parameter is required');
  }

  const server = new Server(
    {
      name: 'mcp-server-gsc',
      version: '0.3.0',
    },
    {
      capabilities: {
        resources: {},
        tools: {},
        prompts: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'list_sites',
          description: 'List all sites in Google Search Console',
          inputSchema: zodToJsonSchema(z.object({})),
        },
        {
          name: 'search_analytics',
          description: 'Get search performance data from Google Search Console',
          inputSchema: zodToJsonSchema(SearchAnalyticsSchema),
        },
        {
          name: 'enhanced_search_analytics',
          description: 'Enhanced search analytics with up to 25,000 rows, regex filters, and quick wins detection',
          inputSchema: zodToJsonSchema(EnhancedSearchAnalyticsSchema),
        },
        {
          name: 'detect_quick_wins',
          description: 'Automatically detect SEO quick wins and optimization opportunities',
          inputSchema: zodToJsonSchema(QuickWinsDetectionSchema),
        },
        {
          name: 'index_inspect',
          description: 'Inspect a URL to see if it is indexed or can be indexed',
          inputSchema: zodToJsonSchema(IndexInspectSchema),
        },
        {
          name: 'list_sitemaps',
          description: 'List sitemaps for a site in Google Search Console',
          inputSchema: zodToJsonSchema(ListSitemapsSchema),
        },
        {
          name: 'get_sitemap',
          description: 'Get a sitemap for a site in Google Search Console',
          inputSchema: zodToJsonSchema(GetSitemapSchema),
        },
        {
          name: 'submit_sitemap',
          description:
            'Submit (or resubmit) a sitemap for a site in Google Search Console. Needs Full or Owner permission on the property. Resubmitting after a deploy is how Google is told that the <lastmod> dates changed.',
          inputSchema: zodToJsonSchema(SubmitSitemapSchema),
        },
        {
          name: 'inspect_batch',
          description:
            'Inspect many URLs with the URL Inspection API and summarise them: counts by coverage state (indexed, crawled/discovered but not indexed, unknown to Google), canonical mismatches, and one row per URL. URLs come from a list, a sitemap, or the sitemap entries whose <lastmod> is on or after a date. Read-only; uses the 2,000-a-day inspection quota.',
          inputSchema: zodToJsonSchema(InspectBatchSchema),
        },
        {
          name: 'indexnow_submit',
          description:
            'Notify IndexNow engines (Bing, Yandex, Seznam, Naver; not Google) that URLs were added, changed or removed. URLs come from a list, a sitemap, or the sitemap entries whose <lastmod> is on or after a date. Does not use Google credentials.',
          inputSchema: zodToJsonSchema(IndexNowSubmitSchema),
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      if (!request.params.arguments) {
        throw new Error('Arguments are required');
      }

      const searchConsole = new SearchConsoleService(credentials);

      switch (request.params.name) {
        case 'enhanced_search_analytics': {
          const args = EnhancedSearchAnalyticsSchema.parse(request.params.arguments);
          const siteUrl = args.siteUrl;

          // Build enhanced request body
          const requestBody: any = {
            startDate: args.startDate,
            endDate: args.endDate,
            dimensions: args.dimensions,
            searchType: args.type,
            aggregationType: args.aggregationType,
            rowLimit: args.rowLimit, // Up to 25,000!
          };

          // Build filters (including regex support)
          const filters = [];
          if (args.pageFilter) {
            filters.push({
              dimension: 'page',
              operator: args.filterOperator,
              expression: args.pageFilter,
            });
          }
          if (args.queryFilter) {
            filters.push({
              dimension: 'query',
              operator: args.filterOperator,
              expression: args.queryFilter,
            });
          }
          if (args.countryFilter) {
            filters.push({
              dimension: 'country',
              operator: 'equals',
              expression: args.countryFilter,
            });
          }
          if (args.deviceFilter) {
            filters.push({
              dimension: 'device',
              operator: 'equals',
              expression: args.deviceFilter,
            });
          }

          if (filters.length > 0) {
            requestBody.dimensionFilterGroups = [{ groupType: 'and', filters }];
          }

          // Call enhanced search analytics
          const enhancedOptions = {
            regexFilter: args.regexFilter,
            enableQuickWins: args.enableQuickWins,
            quickWinsThresholds: args.quickWinsThresholds,
          };

          const response = await searchConsole.enhancedSearchAnalytics(siteUrl, requestBody, enhancedOptions);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
          };
        }

        case 'detect_quick_wins': {
          const args = QuickWinsDetectionSchema.parse(request.params.arguments);

          // First get search analytics data
          const requestBody: any = {
            startDate: args.startDate,
            endDate: args.endDate,
            dimensions: ['query', 'page'],
            rowLimit: 25000, // Maximum for comprehensive analysis
          };

          const searchResponse = await searchConsole.searchAnalytics(args.siteUrl, requestBody);

          if (!searchResponse.data.rows) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ message: 'No data available for quick wins analysis' }, null, 2),
                },
              ],
            };
          }

          // Apply quick wins detection
          const quickWinsOptions = {
            enableQuickWins: true,
            quickWinsThresholds: {
              minImpressions: args.minImpressions,
              maxCtr: args.maxCtr,
              positionRangeMin: args.positionRangeMin,
              positionRangeMax: args.positionRangeMax,
            },
          };

          const enhancedResult = await searchConsole.enhancedSearchAnalytics(
            args.siteUrl,
            requestBody,
            quickWinsOptions
          );

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  quickWins: (enhancedResult.data as any).quickWins,
                  totalOpportunities: (enhancedResult.data as any).quickWins?.length || 0,
                  thresholds: quickWinsOptions.quickWinsThresholds,
                  analysis: 'Quick wins detection completed'
                }, null, 2),
              },
            ],
          };
        }

        case 'search_analytics': {
          const args = SearchAnalyticsSchema.parse(request.params.arguments);
          const siteUrl = args.siteUrl;

          // --- 动态构建请求体 ---
          const requestBody: any = {
            startDate: args.startDate,
            endDate: args.endDate,
            dimensions: args.dimensions,
            searchType: args.type,
            aggregationType: args.aggregationType,
            rowLimit: args.rowLimit,
          };

          const filters = [];
          if (args.pageFilter) {
            filters.push({
              dimension: 'page',
              operator: args.filterOperator,
              expression: args.pageFilter,
            });
          }
          if (args.queryFilter) {
            filters.push({
              dimension: 'query',
              operator: args.filterOperator,
              expression: args.queryFilter,
            });
          }
          if (args.countryFilter) {
              filters.push({
                dimension: 'country',
                operator: 'equals', // Country filter only supports 'equals'
                expression: args.countryFilter,
              });
          }
          if (args.deviceFilter) {
              filters.push({
                dimension: 'device',
                operator: 'equals', // Device filter only supports 'equals'
                expression: args.deviceFilter,
              });
          }

          if (filters.length > 0) {
            requestBody.dimensionFilterGroups = [{ filters }];
          }
          // --- 构建结束 ---

          const response = await searchConsole.searchAnalytics(siteUrl, requestBody);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
          };
        }

        case 'list_sites': {
          const response = await searchConsole.listSites();
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
          };
        }

        case 'index_inspect': {
          const args = IndexInspectSchema.parse(request.params.arguments);
          const requestBody = {
            siteUrl: args.siteUrl,
            inspectionUrl: args.inspectionUrl,
            languageCode: args.languageCode,
          };
          const response = await searchConsole.indexInspect(requestBody);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
          };
        }

        case 'list_sitemaps': {
          const args = ListSitemapsSchema.parse(request.params.arguments);
          const requestBody = {
            siteUrl: args.siteUrl,
            sitemapIndex: args.sitemapIndex,
          };
          const response = await searchConsole.listSitemaps(requestBody);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
          };
        }

        case 'get_sitemap': {
          const args = GetSitemapSchema.parse(request.params.arguments);
          const requestBody = {
            siteUrl: args.siteUrl,
            feedpath: args.feedpath,
          };
          const response = await searchConsole.getSitemap(requestBody);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
          };
        }

        case 'submit_sitemap': {
          const args = SubmitSitemapSchema.parse(request.params.arguments);
          const requestBody = {
            siteUrl: args.siteUrl,
            feedpath: args.feedpath,
          };
          const response = await searchConsole.submitSitemap(requestBody);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(response.data, null, 2),
              },
            ],
          };
        }

        case 'inspect_batch': {
          const args = InspectBatchSchema.parse(request.params.arguments);
          const all = await resolveUrls(args);
          const urls = all.slice(0, args.limit);
          const results = await searchConsole.indexInspectBatch(args.siteUrl, urls, args.languageCode, args.concurrency);

          const byCoverageState: Record<string, number> = {};
          for (const r of results) {
            const key = r.error ? 'Error' : (r.coverageState ?? 'Unknown');
            byCoverageState[key] = (byCoverageState[key] ?? 0) + 1;
          }
          const notIndexed = results.filter((r) => !r.error && r.verdict !== 'PASS').map((r) => ({ url: r.url, coverageState: r.coverageState, lastCrawlTime: r.lastCrawlTime }));

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    siteUrl: args.siteUrl,
                    matched: all.length,
                    inspected: urls.length,
                    ...(all.length > urls.length ? { skipped: all.length - urls.length, note: `Raise limit (max 200) to inspect the rest.` } : {}),
                    byCoverageState,
                    notIndexed,
                    canonicalMismatches: results.filter((r) => r.canonicalMismatch).map((r) => ({ url: r.url, googleCanonical: r.googleCanonical, userCanonical: r.userCanonical })),
                    errors: results.filter((r) => r.error).map((r) => ({ url: r.url, error: r.error })),
                    results,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case 'indexnow_submit': {
          const args = IndexNowSubmitSchema.parse(request.params.arguments);
          const urls = await resolveUrls(args);
          if (urls.length === 0) {
            throw new Error('No URLs to submit (check sitemapUrl and lastmodOnOrAfter)');
          }
          const result = await submitIndexNow({
            host: args.host,
            key: args.key,
            keyLocation: args.keyLocation,
            endpoint: args.endpoint,
            urls,
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            ...(result.ok ? {} : { isError: true }),
          };
        }

        default:
          throw new Error(`Unknown tool: ${request.params.name}`);
      }
    } catch (error) {
      console.error(error);
      if (error instanceof z.ZodError) {
        throw new Error(
          `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
        );
      }
      throw error;
    }
  });

  return server;
}
