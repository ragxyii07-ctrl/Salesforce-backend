// backend/services/salesforceService.js
// Handles all Salesforce REST API communication

const axios = require('axios');

class SalesforceService {
  constructor() {
    this.accessToken = null;
    this.instanceUrl = null;
    this.tokenExpiry = null;
  }

  // ─── STEP 1: Authenticate with Salesforce ───────────────────────────────
  async authenticate() {
    try {
      // Skip if token still valid (within 1 hour)
      if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
        return true;
      }

      const params = new URLSearchParams();
      params.append('grant_type', 'password');
      params.append('client_id', process.env.SF_CLIENT_ID);
      params.append('client_secret', process.env.SF_CLIENT_SECRET);
      params.append('username', process.env.SF_USERNAME);
      // Password + Security Token combined (no space)
      params.append('password', process.env.SF_PASSWORD + process.env.SF_SECURITY_TOKEN);

      const response = await axios.post(
        `${process.env.SF_LOGIN_URL}/services/oauth2/token`,
        params,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      this.accessToken = response.data.access_token;
      this.instanceUrl = response.data.instance_url;
      this.tokenExpiry = Date.now() + (60 * 60 * 1000); // 1 hour

      console.log('✅ Salesforce authenticated successfully');
      return true;
    } catch (err) {
      console.error('❌ Salesforce auth failed:', err.response?.data || err.message);
      throw new Error('Salesforce authentication failed: ' + (err.response?.data?.error_description || err.message));
    }
  }

  // ─── Helper: Make authenticated API call ────────────────────────────────
  async apiCall(method, endpoint, data = null) {
    await this.authenticate();

    const config = {
      method,
      url: `${this.instanceUrl}/services/data/v57.0${endpoint}`,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    };

    if (data) config.data = data;

    const response = await axios(config);
    return response.data;
  }

  // ─── STEP 2: Create or Find Account (Customer) ──────────────────────────
  async upsertAccount(customerName, storeName) {
    try {
      const name = customerName === 'Walk-in Customer'
        ? `Walk-in Customer (${storeName})`
        : customerName;

      // Check if account already exists
      const query = `SELECT Id, Name FROM Account WHERE Name = '${name.replace(/'/g, "\\'")}' LIMIT 1`;
      const result = await this.apiCall('GET', `/query?q=${encodeURIComponent(query)}`);

      if (result.records && result.records.length > 0) {
        return result.records[0].Id;
      }

      // Create new Account
      const account = await this.apiCall('POST', '/sobjects/Account', {
        Name: name,
        Type: 'Customer',
        Description: `Retail customer from ${storeName} - CloudSales System`,
        AccountSource: 'Other'
      });

      console.log(`✅ SF Account created: ${name} → ${account.id}`);
      return account.id;
    } catch (err) {
      console.error('❌ SF Account error:', err.response?.data || err.message);
      throw err;
    }
  }

  // ─── STEP 3: Create Opportunity (The Sale) ──────────────────────────────
  async createOpportunity(sale, accountId, storeName) {
    try {
      const closeDate = new Date(sale.createdAt || Date.now())
        .toISOString().split('T')[0]; // YYYY-MM-DD

      const opportunity = await this.apiCall('POST', '/sobjects/Opportunity', {
        Name: `${sale.saleNumber} - ${storeName}`,
        AccountId: accountId,
        StageName: sale.status === 'completed' ? 'Closed Won' : 'Prospecting',
        CloseDate: closeDate,
        Amount: sale.totalAmount,
        Description: `Sale from CloudSales System\nItems: ${sale.items.map(i => `${i.productName} x${i.quantity}`).join(', ')}\nPayment: ${sale.paymentMethod?.toUpperCase()}\nDiscount: ₹${sale.discount || 0}\nTax: ₹${sale.tax || 0}`,
        LeadSource: 'Other',
        Type: 'Existing Business'
      });

      console.log(`✅ SF Opportunity created: ${sale.saleNumber} → ${opportunity.id}`);
      return opportunity.id;
    } catch (err) {
      console.error('❌ SF Opportunity error:', err.response?.data || err.message);
      throw err;
    }
  }

  // ─── STEP 4: Create Opportunity Line Items (Products) ───────────────────
  async createOpportunityLineItems(opportunityId, items) {
    try {
      for (const item of items) {
        // Get or create Pricebook Entry
        const pricebookEntryId = await this.getOrCreatePricebookEntry(item);

        if (pricebookEntryId) {
          await this.apiCall('POST', '/sobjects/OpportunityLineItem', {
            OpportunityId: opportunityId,
            PricebookEntryId: pricebookEntryId,
            Quantity: item.quantity,
            UnitPrice: item.unitPrice,
            TotalPrice: item.subtotal,
            Description: item.productName
          });
        }
      }
      console.log(`✅ SF Line items created for opportunity: ${opportunityId}`);
    } catch (err) {
      // Line items failing shouldn't block the main sync
      console.error('⚠️ SF Line items warning:', err.response?.data || err.message);
    }
  }

  // ─── Helper: Get or Create Product in Salesforce Pricebook ─────────────
  async getOrCreatePricebookEntry(item) {
    try {
      // Check if product exists
      const prodQuery = `SELECT Id FROM Product2 WHERE Name = '${item.productName.replace(/'/g, "\\'")}' LIMIT 1`;
      const prodResult = await this.apiCall('GET', `/query?q=${encodeURIComponent(prodQuery)}`);

      let productId;
      if (prodResult.records && prodResult.records.length > 0) {
        productId = prodResult.records[0].Id;
      } else {
        // Create product
        const newProduct = await this.apiCall('POST', '/sobjects/Product2', {
          Name: item.productName,
          IsActive: true,
          Description: `Retail product synced from CloudSales`
        });
        productId = newProduct.id;
      }

      // Get standard pricebook
      const pbQuery = `SELECT Id FROM Pricebook2 WHERE IsStandard = true LIMIT 1`;
      const pbResult = await this.apiCall('GET', `/query?q=${encodeURIComponent(pbQuery)}`);
      const pricebookId = pbResult.records[0]?.Id;

      if (!pricebookId) return null;

      // Check pricebook entry
      const pbeQuery = `SELECT Id FROM PricebookEntry WHERE Product2Id = '${productId}' AND Pricebook2Id = '${pricebookId}' LIMIT 1`;
      const pbeResult = await this.apiCall('GET', `/query?q=${encodeURIComponent(pbeQuery)}`);

      if (pbeResult.records && pbeResult.records.length > 0) {
        return pbeResult.records[0].Id;
      }

      // Create pricebook entry
      const pbe = await this.apiCall('POST', '/sobjects/PricebookEntry', {
        Pricebook2Id: pricebookId,
        Product2Id: productId,
        UnitPrice: item.unitPrice,
        IsActive: true
      });

      return pbe.id;
    } catch (err) {
      console.error('⚠️ Pricebook entry warning:', err.message);
      return null;
    }
  }

  // ─── MAIN: Push entire sale to Salesforce ───────────────────────────────
  async pushSaleToSalesforce(sale, storeName) {
    try {
      console.log(`🔄 Syncing sale ${sale.saleNumber} to Salesforce...`);

      // Step 1: Get/Create Account
      const accountId = await this.upsertAccount(sale.customerName, storeName);

      // Step 2: Create Opportunity
      const opportunityId = await this.createOpportunity(sale, accountId, storeName);

      // Step 3: Add Line Items
      await this.createOpportunityLineItems(opportunityId, sale.items);

      console.log(`✅ Sale ${sale.saleNumber} fully synced to Salesforce!`);
      return { success: true, opportunityId, accountId };
    } catch (err) {
      console.error(`❌ Salesforce sync failed for ${sale.saleNumber}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  // ─── TEST: Verify connection works ──────────────────────────────────────
  async testConnection() {
    try {
      await this.authenticate();
      const result = await this.apiCall('GET', '/sobjects/');
      return {
        success: true,
        instanceUrl: this.instanceUrl,
        message: 'Salesforce connected successfully!',
        objectCount: result.sobjects?.length || 0
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

// Export singleton instance
module.exports = new SalesforceService();
