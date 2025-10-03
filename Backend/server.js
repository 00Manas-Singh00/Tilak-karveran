import express from 'express';
import cors from 'cors';
import { companyData } from './companyData.js';
import fs from 'fs';

const logStream = fs.createWriteStream('server.log', { flags: 'a' });

function log(...args) {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(' ');
  const logMessage = `[${timestamp}] ${message}\n`;
  
  process.stdout.write(logMessage);
  logStream.write(logMessage);
}
process.on('unhandledRejection', (reason, promise) => {
  log('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
  log('Uncaught Exception:', error);
});

const app = express();
app.use(cors());
app.use(express.json());

function loadData() {
  log(`Loading embedded company data...`);
  try {
    log(`Successfully loaded data for ${companyData.length} companies`);
    return companyData;
  } catch (error) {
    log('Error loading embedded data:', error);
    throw new Error(`Failed to load embedded data: ${error.message}`);
  }
}

function parseData() {
  log('Loading data...');
  const rawData = loadData();
  log(`Found data for ${rawData.length} companies`);
  
  const companies = new Set();
  const metrics = new Set();
  const records = [];
  
  for (const companyData of rawData) {
    const ticker = companyData.Ticker || '';
    const companyName = companyData['Company name'] || '';
    
    if (!ticker || !companyName) continue;
    
    companies.add(companyName);
    
    const financials = companyData.Financials || {};
    
    for (const [metric, years] of Object.entries(financials)) {
      if (!years || typeof years !== 'object') continue;
      
      metrics.add(metric);
      
      for (const [yearStr, value] of Object.entries(years)) {
        if (typeof value !== 'number') continue;
        
        const year = parseInt(yearStr, 10);
        if (isNaN(year)) continue;
        
        records.push({
          company: companyName,
          ticker: ticker,
          field: metric.toLowerCase(),
          year: year,
          value: value
        });
      }
    }
  }
  
  const companyList = Array.from(companies).sort();
  const metricList = Array.from(metrics).sort();
  
  log(`Processed ${records.length} data points for ${companyList.length} companies and ${metricList.length} metrics`);
  
  return { 
    records,
    companies: companyList,
    metrics: metricList 
  };
}

app.get('/api/companies', (req, res) => {
  log('Request received for /api/companies');
  try {
    const data = parseData();
    log(`Found ${data.companies.length} companies`);
    res.json({ 
      success: true,
      count: data.companies.length,
      companies: data.companies 
    });
  } catch (err) {
    log('Error in /api/companies:', err);
    res.status(500).json({ 
      success: false,
      error: String(err.message || err),
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

app.get('/api/metrics', (req, res) => {
  log('Request received for /api/metrics');
  try {
    const data = parseData();
    log(`Found ${data.metrics.length} metrics`);
    res.json({ 
      success: true,
      count: data.metrics.length,
      metrics: data.metrics 
    });
  } catch (err) {
    log('Error in /api/metrics:', err);
    res.status(500).json({ 
      success: false,
      error: String(err.message || err),
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

app.get('/api/data', (req, res) => {
  const company = String(req.query.company || '').trim();
  const metric = String(req.query.metric || '').trim().toLowerCase();
  
  log(`Request received for /api/data?company=${company}&metric=${metric}`);
  
  if (!company || !metric) {
    log('Missing required parameters');
    return res.status(400).json({ 
      success: false,
      error: 'Missing required query params: company, metric',
      received: { company, metric }
    });
  }

  try {
    const { records } = parseData();
    log(`Processing request for company: ${company}, metric: ${metric}`);
    log(`Total records: ${records.length}`);
    
    const companyRecords = records.filter(r => 
      r.company.toLowerCase() === company.toLowerCase() && 
      r.field.toLowerCase() === metric.toLowerCase()
    );
    
    log(`Found ${companyRecords.length} records for company=${company}, metric=${metric}`);
    
    if (companyRecords.length === 0) {
      log('No data found for the specified company and metric');
      return res.status(404).json({
        success: false,
        error: `No data found for company '${company}' and metric '${metric}'`,
        company,
        metric,
        found: false
      });
    }
    
    const points = companyRecords
      .map(r => ({
        year: r.year,
        value: r.value
      }))
      .sort((a, b) => a.year - b.year);
    
    const ticker = companyRecords[0].ticker;
    
    res.json({ 
      success: true,
      company: {
        name: company,
        ticker: ticker
      },
      metric,
      points,
      count: points.length,
      found: points.length > 0
    });
  } catch (err) {
    log('Error in /api/data:', err);
    res.status(500).json({ 
      success: false,
      error: String(err.message || err),
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  log(`Backend server started and listening on http://localhost:${PORT}`);
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
