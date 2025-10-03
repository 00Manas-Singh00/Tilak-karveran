import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import './App.css';

const API_TIMEOUT = 10000;
const RETRY_DELAY = 2000;
const MAX_RETRIES = 3;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface FetchOptions extends RequestInit {
  headers?: Record<string, string>;
}

const fetchWithTimeout = async (url: string, options: FetchOptions = {}, timeout = API_TIMEOUT) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    } as RequestInit);
    clearTimeout(id);
    return response;
  } catch (error: unknown) {
    clearTimeout(id);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw error;
  }
};

type ApiResponse<T> = {
  success: boolean;
  error?: string;
  message?: string;
} & T;

type CompanyResponse = ApiResponse<{ companies: string[]; count: number }>;
type MetricResponse = ApiResponse<{ metrics: string[]; count: number }>;
type DataResponse = ApiResponse<{
  company: { name: string; ticker: string };
  metric: string;
  points: DataPoint[];
  count: number;
  found: boolean;
}>;

type DataPoint = { year: number; value: number }

function LineChart({ points, title }: { points: DataPoint[]; title: string }) {
  const width = 800
  const height = 420
  const margin = { top: 30, right: 30, bottom: 40, left: 70 }

  const years = points.map((p) => p.year)
  const values = points.map((p) => p.value)
  const minYear = Math.min(...years)
  const maxYear = Math.max(...years)
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)

  const xScale = (y: number) => {
    const rw = width - margin.left - margin.right
    return margin.left + ((y - minYear) / (maxYear - minYear || 1)) * rw
  }
  const yScale = (v: number) => {
    const rh = height - margin.top - margin.bottom
    return margin.top + rh - ((v - minVal) / (maxVal - minVal || 1)) * rh
  }

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.year)} ${yScale(p.value)}`)
    .join(' ')

  const xTicks = Array.from(new Set(years))
  const yTicks = 5
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => minVal + (i * (maxVal - minVal)) / yTicks)

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`}>
      <text x={width / 2} y={18} textAnchor="middle" className="chart-title">{title}</text>
      {/* axes */}
      <line x1={margin.left} y1={height - margin.bottom} x2={width - margin.right} y2={height - margin.bottom} className="axis" />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={height - margin.bottom} className="axis" />

      {/* x ticks */}
      {xTicks.map((yr) => (
        <g key={yr}>
          <line x1={xScale(yr)} y1={height - margin.bottom} x2={xScale(yr)} y2={height - margin.bottom + 6} className="tick" />
          <text x={xScale(yr)} y={height - margin.bottom + 20} textAnchor="middle" className="tick-label">{yr}</text>
        </g>
      ))}

      {/* y ticks */}
      {yTickVals.map((v, i) => (
        <g key={i}>
          <line x1={margin.left - 6} y1={yScale(v)} x2={margin.left} y2={yScale(v)} className="tick" />
          <text x={margin.left - 10} y={yScale(v)} textAnchor="end" dominantBaseline="middle" className="tick-label">
            {formatNumber(v)}
          </text>
          <line x1={margin.left} y1={yScale(v)} x2={width - margin.right} y2={yScale(v)} className="grid" />
        </g>
      ))}

      {/* line */}
      <path d={pathD} className="line" />

      {/* points */}
      {points.map((p, i) => (
        <circle key={i} cx={xScale(p.year)} cy={yScale(p.value)} r={3} className="dot" />
      ))}
    </svg>
  )
}

function formatNumber(n: number) {
  if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(0)
}

const App: React.FC = () => {
  const [companies, setCompanies] = useState<string[]>([]);
  const [metrics, setMetrics] = useState<string[]>([]);
  
  const [selectedCompany, setSelectedCompany] = useState<string>('');
  const [selectedMetric, setSelectedMetric] = useState<string>('');
  
  const [chartData, setChartData] = useState<DataPoint[]>([]);
  
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isLoadingOptions, setIsLoadingOptions] = useState<boolean>(true);
  const [companyTicker, setCompanyTicker] = useState<string>('');

  const retryCountRef = useRef(0);
  const lastFetchTimeRef = useRef<number | null>(null);
  
  useEffect(() => {
    let isMounted = true;
    
    const fetchOptions = async (retryCount = 0) => {
      if (!isMounted) return;
      
      setIsLoadingOptions(true);
      setError(null);
      
      try {
        const [companiesRes, metricsRes] = await Promise.all([
          fetchWithTimeout('/api/companies')
            .then(async r => {
              if (!r.ok) {
                const errorData = await r.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP error! status: ${r.status}`);
              }
              return r.json() as Promise<CompanyResponse>;
            })
            .then(data => {
              if (!data.success) {
                throw new Error(data.error || 'Failed to load companies');
              }
              return data;
            }),
          
          fetchWithTimeout('/api/metrics')
            .then(async r => {
              if (!r.ok) {
                const errorData = await r.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP error! status: ${r.status}`);
              }
              return r.json() as Promise<MetricResponse>;
            })
            .then(data => {
              if (!data.success) {
                throw new Error(data.error || 'Failed to load metrics');
              }
              return data;
            }),
          
          delay(500)
        ]);
        
        if (!isMounted) return;
        
        setCompanies(companiesRes.companies || []);
        setMetrics(metricsRes.metrics || []);
        retryCountRef.current = 0; 
        lastFetchTimeRef.current = Date.now();
        
      } catch (e) {
        console.error('Error loading options:', e);
        
        if (!isMounted) return;
        
        if (retryCount < MAX_RETRIES - 1) {
          console.log(`Retrying... (${retryCount + 1}/${MAX_RETRIES})`);
          await delay(RETRY_DELAY * (retryCount + 1));
          fetchOptions(retryCount + 1);
          return;
        }
        
        setError(e instanceof Error ? `${e.message} Please try refreshing the page.` : 'Failed to load data');
      } finally {
        if (isMounted) {
          setIsLoadingOptions(false);
        }
      }
    };
    
    fetchOptions();
    
    return () => {
      isMounted = false;
    };
  }, [])

  const fetchData = useCallback(async (retryCount = 0) => {
    if (!selectedCompany || !selectedMetric) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const [data] = await Promise.all([
        fetchWithTimeout(
          `/api/data?company=${encodeURIComponent(selectedCompany)}&metric=${encodeURIComponent(selectedMetric)}`
        )
          .then(async r => {
            if (!r.ok) {
              const errorData = await r.json().catch(() => ({}));
              throw new Error(errorData.error || `HTTP error! status: ${r.status}`);
            }
            return r.json() as Promise<DataResponse>;
          })
          .then(data => {
            if (!data.success) {
              throw new Error(data.error || 'No data available');
            }
            return data;
          }),
        
        delay(500)
      ]);
      
      if (data.company?.ticker) {
        setCompanyTicker(data.company.ticker);
      }
      
      const sortedPoints = [...(data.points || [])].sort((a, b) => a.year - b.year);
      setChartData(sortedPoints);
      retryCountRef.current = 0; 
      lastFetchTimeRef.current = Date.now();
      
    } catch (e: any) {
      console.error('Error loading data:', e);
      
      if (retryCount < MAX_RETRIES - 1) {
        console.log(`Retrying data fetch... (${retryCount + 1}/${MAX_RETRIES})`);
        await delay(RETRY_DELAY * (retryCount + 1));
        fetchData(retryCount + 1);
        return;
      }
      
      setError(e?.message || 'Failed to load data. Please try again.');
      setChartData([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCompany, selectedMetric]);
  
  useEffect(() => {
    const controller = new AbortController();
    
    if (selectedCompany && selectedMetric) {
      fetchData();
    } else {
      setChartData([]);
      setError(null);
    }
    
    return () => {
      controller.abort();
    };
  }, [selectedCompany, selectedMetric, fetchData]);

  const displayMetric = useMemo(() => {
    if (!selectedMetric) return '';
    return selectedMetric
      .split(/[\s_]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }, [selectedMetric]);

  const latestDataPoint = useMemo(() => {
    if (chartData.length === 0) return null;
    return chartData[chartData.length - 1];
  }, [chartData]);

  const currentValue = useMemo(() => {
    if (!latestDataPoint) return { value: 'N/A', unit: '' };
    
    const value = latestDataPoint.value;
    let formattedValue = formatNumber(value);
    let unit = '';
    
    if (Math.abs(value) >= 1_000_000_000) {
      unit = 'B';
    } else if (Math.abs(value) >= 1_000_000) {
      unit = 'M';
    } else if (Math.abs(value) >= 1_000) {
      unit = 'K';
    }
    
    return { value: formattedValue, unit };
  }, [latestDataPoint]);

  const percentageChange = useMemo(() => {
    if (chartData.length < 2) return null;
    
    const latest = chartData[chartData.length - 1].value;
    const previous = chartData[chartData.length - 2].value;
    
    if (Math.abs(previous) < 0.0001) return null;
    
    const change = ((latest - previous) / Math.abs(previous)) * 100;
    
    return Math.abs(change) > 1000000 ? null : change;
  }, [chartData]);
  
  const dateRange = useMemo(() => {
    if (chartData.length === 0) return '';
    const startYear = chartData[0].year;
    const endYear = chartData[chartData.length - 1].year;
    return startYear === endYear ? `${startYear}` : `${startYear} - ${endYear}`;
  }, [chartData]);
  
  const previousPeriodValue = useMemo(() => {
    if (chartData.length < 2) return null;
    const value = chartData[chartData.length - 2].value;
    return { 
      value: formatNumber(value),
      unit: Math.abs(value) >= 1_000_000_000 ? 'B' : 
            Math.abs(value) >= 1_000_000 ? 'M' :
            Math.abs(value) >= 1_000 ? 'K' : ''
    };
  }, [chartData]);
  
  const lastUpdated = useMemo(() => {
    return lastFetchTimeRef.current ? new Date(lastFetchTimeRef.current).toLocaleTimeString() : null;
  }, [chartData]);

  return (
    <div className="container">
      <aside className="sidebar">
        <h1 className="title">Financial Dashboard</h1>
        
        <div className="section">
          <label htmlFor="company-select" className="select-label">Company</label>
          <div className="select-wrapper">
            <select 
              id="company-select"
              className="select"
              value={selectedCompany}
              onChange={(e) => {
                setSelectedCompany(e.target.value);
                setSelectedMetric(''); // Reset metric when company changes
              }}
              disabled={isLoadingOptions || isLoading}
              aria-busy={isLoadingOptions}
              aria-label="Select a company"
            >
              <option value="">Select a company</option>
              {isLoadingOptions ? (
                <option value="" disabled>Loading companies...</option>
              ) : (
                companies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))
              )}
            </select>
            {isLoadingOptions && <div className="select-loading">⌛</div>}
          </div>
        </div>
        
        <div className="section">
          <label htmlFor="metric-select" className="select-label">Metric</label>
          <div className="select-wrapper">
            <select 
              id="metric-select"
              className="select"
              value={selectedMetric}
              onChange={(e) => setSelectedMetric(e.target.value)}
              disabled={isLoading || !selectedCompany || isLoadingOptions}
              aria-busy={isLoadingOptions}
              aria-label="Select a metric"
            >
              <option value="">Select a metric</option>
              {isLoadingOptions ? (
                <option value="" disabled>Loading metrics...</option>
              ) : (
                metrics.map((m) => (
                  <option key={m} value={m}>
                    {m.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                  </option>
                ))
              )}
            </select>
            {isLoading && <div className="select-loading">⌛</div>}
          </div>
        </div>
        
        {selectedCompany && selectedMetric && (
          <div className="metric-details">
            {isLoading ? (
              <div className="loading-indicator">
                <div className="loading-spinner"></div>
                <div>Loading {displayMetric} data...</div>
              </div>
            ) : error ? (
              <div className="error-message">
                <div className="error-icon">⚠️</div>
                <div>{error}</div>
              </div>
            ) : chartData.length > 0 ? (
              <>
                <div className="metric-header">
                  <h3>{displayMetric}</h3>
                  {companyTicker && (
                    <span className="ticker-badge">{companyTicker}</span>
                  )}
                </div>
                
                <div className="metric-value">
                  <span className="value">
                    {currentValue.value}
                    {currentValue.unit && <span className="unit">{currentValue.unit}</span>}
                  </span>
                  {percentageChange !== null && (
                    <span 
                      className={`change-indicator ${percentageChange >= 0 ? 'positive' : 'negative'}`}
                      title={percentageChange >= 0 ? 'Increase from previous period' : 'Decrease from previous period'}
                    >
                      {percentageChange >= 0 ? '▲' : '▼'} {Math.abs(percentageChange).toFixed(2)}%
                    </span>
                  )}
                </div>
                
                <div className="metric-meta">
                  <div className="metric-period">
                    <span className="meta-label">Period:</span>
                    <span>{dateRange}</span>
                  </div>
                  
                  {previousPeriodValue && (
                    <div className="previous-period" title="Previous period value">
                      <span className="meta-label">Previous:</span>
                      <span>
                        {previousPeriodValue.value}
                        {previousPeriodValue.unit && <span className="unit">{previousPeriodValue.unit}</span>}
                      </span>
                    </div>
                  )}
                  
                  <div className="data-points">
                    <span className="meta-label">Data Points:</span>
                    <span>{chartData.length}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="no-data">
                No data available for the selected criteria.
              </div>
            )}
          </div>
        )}
      </aside>
      
      <main className="main">
        {!selectedCompany || !selectedMetric ? (
          <div className="welcome-screen">
            <div className="welcome-icon">📊</div>
            <h2>Welcome to Financial Dashboard</h2>
            <p>Select a company and a metric to visualize financial data trends over time.</p>
            <div className="hint">
              <div>💡 <strong>Tip:</strong> Start by selecting a company from the dropdown.</div>
              {isLoadingOptions && <div className="loading-options">Loading data...</div>}
            </div>
          </div>
        ) : isLoading ? (
          <div className="chart-loading">
            <div className="loading-spinner"></div>
            <div className="loading-text">Loading {displayMetric} data for {selectedCompany}...</div>
          </div>
        ) : error ? (
          <div className="error-state">
            <div className="error-icon">⚠️</div>
            <h3>Error Loading Data</h3>
            <p>{error}</p>
            <div className="error-actions">
              <button 
                className="btn primary"
                onClick={() => {
                  fetchData();
                }}
              >
                Retry
              </button>
              <button 
                className="btn secondary"
                onClick={() => {
                  setSelectedCompany('');
                  setSelectedMetric('');
                  setError(null);
                }}
              >
                Start Over
              </button>
            </div>
          </div>
        ) : chartData.length === 0 ? (
          <div className="no-data-state">
            <div className="no-data-icon">📭</div>
            <h3>No Data Available</h3>
            <p>We couldn't find any data for {selectedCompany} - {displayMetric}.</p>
            <div className="suggestions">
              <p>Try:</p>
              <ul>
                <li>Selecting a different metric</li>
                <li>Choosing another company</li>
                <li>Checking if the data exists in the source</li>
              </ul>
            </div>
            <button 
              className="btn primary"
              onClick={() => {
                setSelectedMetric('');
              }}
            >
              Select Different Metric
            </button>
          </div>
        ) : (
          <div className="chart-container">
            <div className="chart-header">
              <h2>{selectedCompany} - {displayMetric}</h2>
              <div className="chart-period">{dateRange}</div>
            </div>
            <div className="chart-wrapper">
              <LineChart 
                points={chartData} 
                title={`${selectedCompany} - ${displayMetric}`}
              />
            </div>
            <div className="chart-footer">
              <div className="chart-legend">
                <div className="legend-item">
                  <span className="legend-color" style={{ backgroundColor: '#3b82f6' }}></span>
                  <span>{displayMetric} ({companyTicker || selectedCompany})</span>
                </div>
                {percentageChange !== null && (
                  <div className="legend-change" title="Change from previous period">
                    <span>Period Change: </span>
                    <span className={percentageChange >= 0 ? 'positive' : 'negative'}>
                      {percentageChange >= 0 ? '▲' : '▼'} {Math.abs(percentageChange).toFixed(2)}%
                    </span>
                  </div>
                )}
              </div>
              {lastUpdated && (
                <div className="last-updated" title="Last data refresh time">
                  Updated: {lastUpdated}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
