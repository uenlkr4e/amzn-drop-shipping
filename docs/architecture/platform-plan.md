# Amazon Dropshipping Automation Platform

## Consolidated Product Requirements, Architecture, and Developer/AI-Agent Plan

**Document purpose:** Consolidated implementation brief for the
development team or AI coding agent.\
**Target marketplaces:** Amazon US, Canada, and Mexico.\
**Primary technology direction:** React/Next.js, Node.js/TypeScript,
NestJS with Fastify, PostgreSQL, Redis/BullMQ, deployed on Railway.\
**Amazon product research provider:** Keepa (the original request said
"Keap"; this plan assumes **Keepa**).\
**Revision 2 (2026-11-23):** Reconciled against the client requirements
document (Modules 1--5). The client has agreed to the compliance
boundaries in this plan: no scraping, no Seller Central browser
automation, no automated retail-checkout bots, and approval requests
submitted by an operator using owner-approved standard attestations.
Main changes: discovery direction (CA/MX seller storefronts → US
sourcing), ASIN matching, US stock observability, shipping/tax/duty
cost model, listing-restriction workflow, Amazon Business purchasing,
handling time, SP-API notifications, Amazon Data Protection Policy, and
Canada-first rollout.

------------------------------------------------------------------------

## 1. Product vision

Build a scalable, reliable dropshipping operations platform that
discovers products sold by US-based sellers on Amazon Canada and Mexico,
confirms each product can be sourced from Amazon US, identifies suitable
products, calculates profitable prices for Amazon Canada and Mexico,
manages
listings and inventory, processes orders, coordinates purchasing and
warehouse consolidation, tracks shipments, and produces accurate daily
profitability reports.

The system should automate repetitive operational work while keeping
policy-sensitive, financial, and compliance decisions auditable and
subject to appropriate human confirmation.

### Initial scope

-   Amazon US as the primary source/supplier marketplace.
-   Amazon Canada and Amazon Mexico as target sales marketplaces.
-   Keepa for product research and product/offer intelligence on all
    three marketplaces (discovery on CA/MX, sourcing data on US).
-   Amazon Selling Partner API (SP-API) for seller-account operations
    where supported.
-   Amazon Business account and Amazon Business Ordering API for
    supplier purchasing on Amazon US (subject to approval).
-   Rollout order: Amazon Canada first, Amazon Mexico once the Canada
    workflow is proven end to end (Mexico adds tax withholding, customs,
    and labeling complexity).
-   PostgreSQL as the system of record.
-   Railway as the initial cloud hosting platform.
-   Architecture that can scale by adding worker capacity and services
    without prematurely introducing Kubernetes or a complex microservice
    estate.

------------------------------------------------------------------------

## 2. Core business workflows

### 2.1 Product discovery and research

Discovery runs in two stages:

1.  **Discovery (target marketplaces).** The user enters seller IDs of
    US-based sellers active on amazon.ca or amazon.com.mx. The system
    retrieves each seller's full catalog on that marketplace (expected
    30,000 to 100,000+ ASINs per seller), then expands coverage through
    category and subcategory traversal so every category and
    sub-branch is covered.
2.  **Sourcing enrichment (Amazon US).** For each discovered product,
    find the matching amazon.com product and collect its US price,
    coupon, availability, Prime eligibility, and stock signals.

**Data source boundary:** Discovery uses Keepa (and SP-API where it
applies), not scraping of Amazon pages. The requirement to "avoid
Amazon bot blocks" is met by using authorized data providers, which do
not get blocked. Keepa supports amazon.com, amazon.ca, and
amazon.com.mx, but coverage and refresh frequency on amazon.com.mx are
thinner than on the US. During Phase 0, verify how many ASINs the Keepa
seller-storefront request returns for very large storefronts, how often
it refreshes, and its token cost.

**ASIN matching:** The same ASIN does not always mean the same item
across marketplaces (pack quantity, variation structure, and model
differences occur). Create an explicit CA/MX ↔ US product match record
for each product, verified by ASIN plus UPC/EAN, brand, model/part
number, and pack quantity where available. Store the match confidence
and method. Only confirmed matches can move to pricing and listing;
low-confidence matches go to a review queue.

Collect, where available from Keepa and other authorized sources, for
both the target-marketplace product and its US match:

-   ASIN and product identifiers
-   Product title, brand, category, and subcategory
-   Current price and price history
-   Rating and review count
-   Number of sellers/offers
-   Whether Amazon is an active seller
-   Prime eligibility and relevant fulfillment information
-   Dimensions and shipping weight
-   Availability/stock signals
-   Product variations and marketplace presence

Requirements:

1.  Support discovery from seller IDs and category/subcategory
    traversal.
2.  Support large product sets, potentially tens of thousands to
    100,000+ products.
3.  Process discovery and enrichment asynchronously.
4.  Persist progress so a throttled, interrupted, or blocked run can
    resume without restarting from the beginning.
5.  Deduplicate products by stable identifiers such as marketplace +
    ASIN.
6.  Store source, observation time, and data freshness for collected
    values.
7.  Respect Keepa quotas, Amazon terms, API limits, and applicable
    data-use restrictions.
8.  Do not assume every requested data field is available for every
    product or marketplace.
9.  Budget Keepa tokens explicitly. Product requests that include offer
    and stock data cost much more than basic product requests. Estimate
    tokens per day for discovery plus the refresh intervals in section
    3 before choosing a Keepa plan, and expose current token usage in
    the operations dashboard.

### 2.2 Product eligibility and filtering

Provide configurable filters and scoring rules to decide which products
are candidates for listing.

Potential filters include:

-   Minimum/maximum price
-   Minimum rating and review count
-   Maximum seller count
-   Whether Amazon is a seller
-   Prime eligibility
-   Category restrictions
-   Product size/weight limits
-   Availability and stock confidence
-   Expected profit and margin
-   Marketplace restrictions and listing eligibility (from the SP-API
    Listings Restrictions API; see 2.6)
-   CA/MX ↔ US match confidence
-   Hazardous materials (e.g. lithium batteries, aerosols) that cannot
    be shipped cross-border cheaply or at all
-   Import-restricted or regulated categories (e.g. Health Canada
    regulated products, Mexico NOM certification/labeling requirements,
    Canadian bilingual labeling requirements)
-   Estimated delivery time versus the marketplace handling-time limit

Make thresholds configurable rather than hard-coding business rules.
Preserve the reasons a product passed or failed a filter so users can
understand decisions.

### 2.3 Pricing engine

Calculate target selling prices for Canada and Mexico using:

-   US product cost on amazon.com, after any coupon or discount
-   US sales tax on the purchase (zero if the Amazon Business tax
    exemption applies)
-   Inbound shipping from the US seller to our warehouse (usually zero
    for Prime/free-shipping offers)
-   Cross-border shipping from the warehouse to the reference
    destination (see 2.3.1)
-   Warehouse handling, inspection, and repacking cost
-   Estimated import duties, customs brokerage, and import taxes not
    collected by Amazon
-   Currency conversion
-   Marketplace referral/selling fees, including per-item minimums
-   Marketplace tax withholding (notably amazon.com.mx for sellers
    without a Mexican RFC)
-   Returns allowance
-   Configurable markup or target margin
-   Competitor prices and repricing rules

A baseline pricing formula is:

    P = (C + T + S_in + S_x + H + D + O) × X × (1 + M) / (1 − F − W − R)

Where:

-   `P` = target selling price in the target marketplace currency
-   `C` = US product cost after coupons/discounts (USD)
-   `T` = US sales tax on the purchase (USD; zero when exempt)
-   `S_in` = inbound shipping to our warehouse (USD)
-   `S_x` = cross-border shipping to the reference destination (USD)
-   `H` = warehouse handling/repacking cost per unit (USD)
-   `D` = estimated duties, brokerage, and import taxes not collected by
    Amazon (USD)
-   `O` = other per-unit costs (USD)
-   `X` = exchange rate from USD to the target currency
-   `M` = markup rate
-   `F` = marketplace referral fee rate as a fraction of the selling
    price
-   `W` = marketplace tax withholding rate as a fraction of the selling
    price (zero where not applicable)
-   `R` = returns allowance as a fraction of the selling price

After calculating `P`, apply the referral-fee per-item minimum: if
`F × P` is below the minimum fee, recalculate with the fixed minimum.

**Important:** Markup and margin are not interchangeable. The formula
above applies markup to costs and then accounts for deductions charged
as a percentage of the selling price. Confirm the exact fee treatment,
withholding base (gross vs net of VAT), and duty treatment with real
marketplace fee data and tax advice before production use.

Example from the design discussion (all other costs zero):

-   Product cost: USD 100
-   Cross-border shipping: USD 15
-   FX rate: 1.40 target-currency units per USD
-   Markup: 2%
-   Selling fee: 15%

`(100 + 15) × 1.40 × 1.02 / 0.85` ≈ **CAD 193.20**. This is an
illustrative calculation, not a guaranteed fee quote.

#### 2.3.1 Shipping cost calculation

The client's rule is to base shipping cost on the farthest delivery
point in Canada or Mexico, using carrier rates for the product's weight
or dimensions.

1.  Use billable weight = max(actual weight, dimensional weight), where
    dimensional weight = L × W × H / carrier divisor. Use packaged
    dimensions, plus a configurable packaging allowance.
2.  Configure one or more **reference destinations** per marketplace
    (postal codes). The default is the farthest/most expensive
    destination the business is willing to serve.
3.  Do not call carrier APIs once per product. Build **rate cards**
    (billable-weight bracket × reference destination × service) from
    carrier quotes, refresh them on a schedule, and look up `S_x` from
    the rate card. Store the rate-card version used for each price.
4.  "Farthest point" pricing can make products uncompetitive (e.g.
    Nunavut, Yukon, Baja California Sur). Support two options in
    Settings: (a) price for the farthest point everywhere, or (b) price
    for the farthest point within the regions served and exclude remote
    regions from the shipping template.
5.  Carrier selection at order time (2.9) uses live rates; the rate
    card is only for pricing.

#### 2.3.2 Competitor pricing and undercut

-   For products we have listed, get competitor prices from SP-API
    `ANY_OFFER_CHANGED` notifications and the Product Pricing API.
    These are near-real-time and do not consume Keepa tokens.
-   Use Keepa only for competitor data on products not yet listed.
-   Undercut the relevant competitor price (featured offer, or lowest
    landed price, which is configurable) by a configurable amount (e.g.
    0.10 or 0.20 in target currency), never below the computed floor.
-   **Alternative to evaluate in Phase 3:** compute floor and ceiling
    prices in this system, publish them as the listing's minimum and
    maximum allowed prices, and let Amazon's Automate Pricing tool or an
    existing repricer handle the undercut rule. This removes the most
    latency-sensitive logic from our codebase. Decide based on how much
    control the client needs over the undercut behaviour.

Pricing requirements:

1.  Support marketplace-specific fee schedules and category-level
    overrides.
2.  Example configurable fee assumptions discussed: electronics around
    8%, other categories around 15%. These are placeholders only; actual
    rates must be sourced and maintained per marketplace/category.
3.  Support a configurable competitor-undercut amount, such as CAD/MXN
    equivalent of USD 0.10 or 0.20, subject to minimum-profit
    safeguards.
4.  Support minimum price, maximum price, minimum profit, and minimum
    margin constraints.
5.  Recalculate when any of the client's three price drivers changes:
    (1) the amazon.com price or coupon, (2) the exchange rate, or (3) a
    competitor price on amazon.ca/amazon.com.mx (up or down). Also
    recalculate when fees, rate cards, or tax/duty rules change.
6.  Store pricing inputs, rule version, calculation result, and
    timestamp for auditability.
7.  Avoid price oscillation through thresholds, cooldowns, and
    meaningful-change detection.
8.  Never publish a price that violates configured floors or marketplace
    rules.
9.  Publish price and inventory changes in bulk through SP-API JSON
    listings feeds. Use per-item Listings Items API calls only for
    small or urgent updates, within the per-account rate limits.

### 2.4 Currency conversion

-   Use CurrencyAPI initially, behind a provider abstraction.
-   Store exchange-rate observations with provider and timestamp.
-   Configure refresh intervals and acceptable rate staleness.
-   Define a fallback policy if the FX provider is unavailable.
-   Do not silently use stale rates beyond the configured threshold.
-   Store the FX rate used for every pricing decision and financial
    transaction.

### 2.5 Inventory synchronization

Synchronize target-marketplace inventory based on available US source
inventory, using a configurable safety buffer.

Baseline rule:

`Target quantity = max(0, US available quantity - inventory buffer)`

Example with buffer = 5:

    US available stock   Target quantity
  -------------------- -----------------
                     5                 0
                     8                 3
                    20                15

With buffer = 0, US stock of 5 results in target stock of 5.

**US stock observability (Phase 0 risk):** The rule above assumes we
know the available quantity on amazon.com. For most third-party offers
Amazon does not publish stock levels. Keepa can provide stock estimates
for some offers, but they cost extra tokens and are capped at a maximum
observable quantity. Before building the sync, measure what share of
matched US products return a usable stock number.

Support three signal levels and degrade safely:

  Signal available                         Target quantity
  ---------------------------------------- ----------------------------------------------
  Numeric stock estimate (fresh)           `max(0, US quantity − buffer)`, capped at a configurable maximum
  In stock / low stock / out of stock      Configurable fixed quantity for "in stock", 0 for "low" or "out"
  Stale or no signal                       0, or hold the last value for a configurable grace period, then 0

At order time, re-check US availability before purchasing (2.7). If the
item is no longer available at an acceptable cost, raise an exception
immediately rather than letting the order go late.

Requirements:

-   Configure buffer globally, by marketplace, category, or product.
-   Avoid publishing inventory from stale or low-confidence stock
    signals.
-   Record every inventory observation and synchronization attempt.
-   Handle unavailable, suppressed, or delisted products.
-   Make updates idempotent and reconcile local state against Amazon
    state.
-   Prevent overselling through conservative buffers and order-time
    validation.

### 2.6 Listings and marketplace approvals

The system should create and manage listings in Amazon Canada and Mexico
when the seller account and product are eligible.

Because discovered products already exist on amazon.ca/amazon.com.mx,
listing normally means adding **an offer to an existing ASIN** (SKU,
condition, price, quantity, handling time, shipping template) through
the SP-API Listings Items API or JSON listings feeds. Full product
detail page creation is out of scope for the first release.

#### 2.6.1 Restriction check and approval workflow

SP-API has no endpoint for submitting an "Apply to sell" approval
request, and automating the Seller Central website breaks Amazon's
terms and puts the seller accounts at risk. The client has agreed to
the following workflow, which automates everything up to the
submission itself:

1.  Before listing, call the SP-API **Listings Restrictions API** for
    each ASIN + condition (New) + marketplace + seller account.
2.  Sort each ASIN into one of three groups:
    -   **Unrestricted:** list automatically at the calculated price.
    -   **Approval required (self-attestation):** add to the approval
        queue.
    -   **Approval required (documents, e.g. invoices) or not
        available:** mark ineligible, with the reason recorded.
3.  The approval queue groups ASINs by brand and category, because one
    approval usually unlocks many ASINs. Each entry shows the
    Seller Central "Apply to sell" deep link returned by the
    Restrictions API.
4.  **Standing attestations:** the account owner records, once per
    seller account, the standard answers to the approval questions
    (seller/distributor role; "I'm responsible for all products I sell
    on Amazon…"; "All of the above"; "All products I intend to sell are
    authentic…"). The system shows these answers to the operator next
    to each request. The operator opens the link, submits the
    application in Seller Central, and marks the request submitted.
    Store who approved the standing attestation, when, and its exact
    wording; if Amazon changes the questions, the attestation must be
    re-approved.
5.  Re-check restrictions on a schedule. When an ASIN becomes
    unrestricted, list it automatically at the calculated price.

#### 2.6.2 Listing requirements

1.  Check listing eligibility and required attributes before submission.
2.  Track approval requests, status, operator, and timestamps.
3.  Record Amazon responses and listing status changes.
4.  Support listing errors, retries, and manual remediation.
5.  Set **handling time** (lead time to ship) on every offer to match
    the real purchase → warehouse → dispatch time. Late-shipment and
    cancellation metrics are the main account-health risk of this
    business model; never list with the default handling time.
6.  Use shipping templates that exclude regions the business does not
    serve (see 2.3.1).

**Compliance boundary:** Do not bypass Amazon approval processes,
fabricate answers, automate Seller Central, or attest to facts that the
account owner has not approved. Store each attestation approval and
each submission record.

### 2.7 Order processing and fulfillment workflow

When a customer places an order on Amazon Canada or Mexico:

1.  Receive the order through SP-API notifications where available.
2.  Persist the order immediately and acknowledge/queue follow-up
    processing.
3.  Validate order state, address, item mapping, and fulfillment
    eligibility.
4.  Re-check US availability and cost. If the purchase would fall below
    the minimum profit floor or the item is unavailable, raise an
    exception for an operator.
5.  Place the supplier purchase on amazon.com through the **Amazon
    Business Ordering API** from the Amazon Business buyer account,
    shipping to the designated warehouse. Select the offer using total
    cost, delivery estimate, and Prime/free-shipping eligibility.
    Retail-checkout browser automation is out of scope. If the Ordering
    API is unavailable for the account, fall back to an operator
    purchase queue (one-click deep link plus a form to record the
    Amazon order ID).
    -   Coupons: the Ordering API may not support clipping coupons.
        Treat automatic coupon application as best-effort; pricing must
        not depend on a coupon unless purchasing can actually apply it.
    -   Use Amazon Business tax exemption where the business qualifies,
        so US sales tax is not paid on goods for resale.
6.  Track each supplier purchase and its expected arrival at the
    designated warehouse. Flag purchases that are missing or late
    against the expected date, and notify when they arrive.
7.  Match received parcels to purchase/order items.
8.  Inspect and consolidate multiple items. An order with several items
    is held until every item has arrived, then shipped together;
    alert if any item threatens the ship-by date.
9.  Prepare customer shipment, labels, and customs/export documentation
    as applicable.
10. Dispatch through supported carriers and store tracking details.
11. Update the target Amazon order with shipment confirmation and
    tracking.
12. Monitor delivery, exceptions, cancellations, refunds, and returns.

**Important operational and policy requirement:** Amazon dropshipping
policy requires the selling merchant to remain the seller of record and
responsible for the customer experience. The process must not expose
another retailer as the seller through third-party invoices, packing
slips, or branding. The seller remains responsible for returns and
customer service. Use a warehouse inspection/repacking step where needed
to remove non-compliant third-party materials. Validate the exact
sourcing and fulfillment model with Amazon policy and legal/compliance
advice before launch.

**Customer data (Amazon Data Protection Policy):** Buyer names and
addresses are needed to ship orders, which requires the SP-API
restricted role for direct-to-consumer shipping and access through
Restricted Data Tokens. That access comes with Amazon's Data Protection
Policy (DPP): encryption of PII at rest and in transit, access control
and logging, a limited retention period for PII after shipment, and
incident reporting. Design the order schema so PII lives in separate,
encrypted columns/tables that can be purged on schedule without losing
the financial and operational history.

**Returns:** Amazon.ca and amazon.com.mx returns policies require either
a return address in the marketplace country or prepaid return labels
(or a returnless refund). Decide the returns model in Phase 0 and
include its cost in the returns allowance `R` (2.3).

### 2.8 Warehouse operations

Expected physical model (to be confirmed in Phase 0): supplier
purchases are delivered to a US warehouse near the relevant border (for
example, Washington State or New York for Canada, Texas for Mexico).
Orders are consolidated and repacked there, then sent cross-border
either directly to the customer by carrier, or in bulk to a warehouse
in Canada/Mexico for last-mile delivery. The client requirement to
"transfer products from Canada/Mexico warehouses to border warehouses"
must be clarified against this model before `WarehouseTransfers` is
designed.

Support one or more warehouses, initially with a simple operational
workflow:

-   Expected inbound parcel
-   Parcel received
-   Item matched to supplier purchase and target order
-   Inspection/exception
-   Consolidation
-   Repacking/relabeling
-   Ready to dispatch
-   Dispatched
-   Delivered or exception

Track:

-   Warehouse and location
-   Carrier and inbound tracking
-   Purchase/order references
-   Item quantities
-   Inspection results and photos/documents where needed
-   Handling and consolidation costs
-   Outbound carrier, label, and tracking
-   Operator and timestamps for each status change

### 2.9 Shipping integrations

Design a provider abstraction so carriers can be added without rewriting
order workflows.

Potential integrations, in priority order:

1.  **Amazon Shipping API v2 (Buy Shipping)** where it is available for
    the route and marketplace. Labels bought through Amazon carry
    tracking back to the order automatically and protect seller
    late-delivery metrics.
2.  Cross-border consolidators for US → Canada/Mexico parcels (for
    example Stallion Express, Passport, Asendia). These are often much
    cheaper than retail UPS/FedEx rates for B2C parcels and handle
    customs clearance.
3.  UPS and FedEx (direct accounts, negotiated rates).
4.  Canada Post (domestic legs from a Canadian warehouse).
5.  Mexico domestic carriers with usable APIs (for example Estafeta or
    DHL Express Mexico). Correos de México (Mexico Post) has no
    usable API and unreliable tracking; do not plan on integrating it.

Support:

-   Rate/ service lookup
-   Label creation
-   Tracking updates
-   Shipment cancellation where supported
-   Customs information and documentation where applicable
-   Carrier errors and retry handling

Do not assume the same carrier APIs, service availability, or customs
requirements apply to all routes.

### 2.10 Daily financial reporting

Produce a daily profitability report, with drill-down to marketplace,
order, product, and transaction.

Include:

-   Gross sales
-   Discounts/coupons where relevant
-   Supplier purchase cost
-   Supplier shipping
-   Amazon selling/referral fees
-   Other marketplace fees
-   International and domestic shipping
-   Duties, brokerage, and import taxes
-   Marketplace tax withholding (e.g. amazon.com.mx IVA/ISR)
-   US sales tax paid on supplier purchases, if any
-   Warehouse handling/consolidation
-   Currency conversion impact
-   Refunds, returns, and adjustments
-   Net profit
-   Profit margin

Requirements:

-   Use actual transactions and fee data where available; distinguish
    estimates from settled values.
-   Make reports reproducible and traceable to source transactions.
-   Show daily and historical results in the dashboard's Statistics
    section.
-   Email the daily report to configured recipients.
-   Record report generation and delivery status.
-   Support historical reruns when late fees/refunds arrive.

------------------------------------------------------------------------

## 3. Suggested automation and refresh policy

These are initial operational targets, not guarantees of API
availability. Prefer event/notification-driven processing where
supported, with scheduled reconciliation as a safety net.

  -----------------------------------------------------------------------
  Process                             Initial target
  ----------------------------------- -----------------------------------
  New order intake                    Notification-driven; reconcile
                                      every 2--5 minutes

  Inventory                           Notification-driven where possible;
                                      reconcile every 5--15 minutes

  High-priority product pricing       About every 15 minutes

  Normal-priority pricing             Every 1--4 hours

  Low-priority pricing                Every 12--24 hours

  Exchange rates                      Every 15--30 minutes

  Competitor prices (listed           Notification-driven
  products)                           (`ANY_OFFER_CHANGED`); reconcile
                                      every 30--60 minutes via Product
                                      Pricing API

  Competitor prices (not listed)      Every 12--24 hours via Keepa,
                                      subject to token budget

  Listing restrictions                On discovery; re-check pending
                                      approvals every 6--24 hours

  Shipping rate cards                 Weekly, and when carrier rates
                                      change

  Listing status                      Every 15--30 minutes

  Shipment tracking                   Every 30--60 minutes or carrier
                                      webhook

  Daily financial report              Once per day, after the reporting
                                      cutoff
  -----------------------------------------------------------------------

All schedules must be configurable. Apply rate limits, backoff, jitter,
prioritization, and provider-specific quotas. Product priority (high /
normal / low) is based on sales velocity, margin, and competition, so
the Keepa token budget goes to the products that matter.

------------------------------------------------------------------------

## 4. Technology stack

### 4.1 Frontend

-   React
-   Next.js
-   TypeScript
-   Tailwind CSS
-   shadcn/ui
-   TanStack Query for server-state management

### 4.2 Backend/API

-   Node.js
-   TypeScript
-   NestJS as the application framework
-   Fastify as the HTTP adapter/server layer
-   REST API with OpenAPI/Swagger documentation
-   Class-based modules and dependency injection for clear boundaries

**Framework decision:** Use **NestJS with the Fastify adapter**. NestJS
provides application structure, modules, dependency injection, guards,
validation patterns, and maintainability. Fastify provides the HTTP
server layer. They are complementary, not mutually exclusive.

### 4.3 Database and data access

-   PostgreSQL as the primary system of record
-   Prisma ORM and migrations
-   Redis for caching and queue infrastructure
-   BullMQ for background jobs

Redis is not the source of truth for business data. Persist durable
business state and job outcomes in PostgreSQL.

### 4.4 Integrations

-   Keepa API for product research and product intelligence (amazon.com,
    amazon.ca, amazon.com.mx)
-   Amazon SP-API for seller-account operations, specifically:
    -   Listings Items API and JSON listings feeds (offers, price,
        quantity, handling time)
    -   Listings Restrictions API (gating checks)
    -   Product Pricing API (competitive pricing)
    -   Orders API with Restricted Data Tokens (buyer PII)
    -   Notifications API: `ORDER_CHANGE`, `ANY_OFFER_CHANGED`,
        `LISTINGS_ITEM_STATUS_CHANGE` and related events
    -   Finances API and reports (actual fees, refunds, withholding)
    -   Shipping API v2 (Buy Shipping) where available
-   Amazon Business Ordering API for supplier purchases on amazon.com
-   CurrencyAPI initially for FX rates
-   Carrier/consolidator APIs behind internal provider interfaces
-   Email provider behind a notification abstraction

**Approved infrastructure exception:** SP-API notifications are
delivered only to Amazon SQS or Amazon EventBridge. Use one AWS account
with SQS queues as the notification destination. A worker on Railway
polls SQS and writes each event to `WebhookEvents` in PostgreSQL before
processing. No other AWS services are introduced.

### 4.5 Authentication, storage, testing, and monitoring

-   Authentication: Auth.js or a suitable managed authentication
    provider
-   Object storage: S3-compatible storage for reports, labels,
    documents, and evidence
-   Unit/integration tests: Vitest
-   Browser/end-to-end tests: Playwright
-   Error monitoring: Sentry
-   Telemetry: OpenTelemetry
-   Deployment: Docker containers on Railway
-   Package management: pnpm
-   Monorepo orchestration: Turborepo

------------------------------------------------------------------------

## 5. Application architecture

Start with a modular monolith for the API and independently deployed
worker processes. This keeps the initial system affordable and easier to
operate while allowing individual workers to scale independently.

### 5.1 Monorepo layout

``` text
apps/
  web/                         # Next.js React application
  api/                         # NestJS API using Fastify adapter
  workers/
    product-discovery/
    product-enrichment/
    product-matching/
    notifications/             # SQS poller for SP-API notifications
    price-monitor/
    pricing/
    inventory/
    listings/
    orders/
    purchasing/
    warehouse/
    shipping/
    reporting/

packages/
  database/                    # Prisma schema, migrations, DB utilities
  shared/                      # Shared domain types and utilities
  validation/                  # Shared request/job schemas
  queue/                       # BullMQ queue definitions and helpers
  providers/
    keepa/
    amazon-sp-api/
    amazon-business/
    currency/
    shipping/
    email/
  config/                      # Typed configuration and env validation
  observability/               # Logging, tracing, metrics

docs/
  architecture/
  api/
  operations/
  runbooks/

deployment/
  railway/
```

Workers can share packages and domain logic with the API but should run
as separate Railway services with distinct start commands. Do not deploy
every worker as an independent microservice unless operational load or
team boundaries justify it.

### 5.2 Main backend modules

-   Identity and access control
-   Amazon accounts and marketplace configuration
-   Product catalog
-   Product discovery
-   Product enrichment
-   CA/MX ↔ US product matching
-   Seller/source management
-   Offer and price history
-   Pricing rules and repricing
-   Currency rates
-   Inventory synchronization
-   Listing management
-   Approval workflow
-   Orders and order items
-   Supplier purchasing
-   Warehouse operations
-   Shipping and tracking
-   Fees and financial transactions
-   Profitability and reporting
-   Notifications
-   Audit and integration logs
-   Background job administration

### 5.3 Queue design

Create separate BullMQ queues or clearly isolated job types for:

-   Product discovery
-   Product enrichment
-   Product matching
-   SP-API notification intake
-   Product/offer monitoring
-   Price calculation and publication
-   Inventory synchronization
-   Listing creation and status checks
-   Order intake and processing
-   Supplier purchasing
-   Warehouse events
-   Shipping labels and tracking
-   Daily reporting and email delivery

Queue requirements:

-   Idempotent job handlers
-   Bounded concurrency per provider/account
-   Retry with exponential backoff and jitter
-   Explicit handling for permanent vs transient failures
-   Job progress and operational status
-   Failed-job/dead-letter review and replay
-   Per-marketplace and per-account rate limiting
-   Graceful shutdown and job lock recovery
-   Job deduplication where appropriate
-   Durable business status in PostgreSQL

Use a transactional outbox pattern for critical events that must be
committed to PostgreSQL and then reliably published to queues.

------------------------------------------------------------------------

## 6. PostgreSQL data model

The following is a logical starting point. Final tables and
relationships should be refined during schema design.

### 6.1 Accounts and configuration

-   `Users`
-   `Roles`
-   `UserRoles`
-   `AmazonAccounts`
-   `Marketplaces`
-   `AmazonAccountMarketplaces`
-   `PricingRules`
-   `MarketplaceFeeRules`
-   `InventoryBufferRules`
-   `NotificationSettings`
-   `ProviderConfigurations`
-   `StandingAttestations` (per seller account: wording, approver,
    approval time, superseded time)

### 6.2 Product research and catalog

-   `Sellers`
-   `Categories`
-   `Products`
-   `ProductMarketplaces`
-   `ProductSellerSources`
-   `ProductOffers`
-   `ProductPriceHistory`
-   `ProductResearchRuns`
-   `ProductResearchRunItems`
-   `ProductEligibilityResults`
-   `ProductMatches` (target-marketplace ASIN ↔ US ASIN, match method,
    confidence, review status)
-   `StockObservations` (source, signal level, quantity if known,
    observed time)

Keep global product identity separate from marketplace-specific
attributes. A product can have different prices, ratings, availability,
and listing state in each marketplace.

### 6.3 Currency and costs

-   `ExchangeRates`
-   `ShippingRateHistory`
-   `ShippingRateCards` and `ShippingRateCardEntries` (versioned)
-   `ReferenceDestinations`
-   `TaxWithholdingRules` (per marketplace/account)
-   `DutyRules` (per destination country/category, de minimis
    thresholds)
-   `ProductCostSnapshots`
-   `MarketplaceFeeRules`

### 6.4 Listings and approvals

-   `ProductListings`
-   `ListingSubmissionAttempts`
-   `ListingRestrictionChecks`
-   `ListingApprovalRequests` (grouped by brand/category; operator,
    submission time, outcome)
-   `ListingApprovalEvidence`
-   `ListingStatusHistory`

### 6.5 Inventory and synchronization

-   `InventorySnapshots`
-   `InventorySyncJobs`
-   `InventorySyncResults`
-   `InventoryAdjustments`

### 6.6 Orders and fulfillment

-   `Orders`
-   `OrderItems`
-   `OrderBuyerPII` (encrypted, purged per DPP retention policy)
-   `SupplierPurchases`
-   `SupplierPurchaseItems`
-   `Shipments`
-   `ShipmentItems`
-   `ShipmentTrackingEvents`
-   `Warehouses`
-   `WarehouseInventory`
-   `WarehouseReceipts`
-   `WarehouseInspections`
-   `WarehouseTransfers`
-   `ShippingLabels`

### 6.7 Finance and reporting

-   `AmazonFees`
-   `FinancialTransactions`
-   `Refunds`
-   `Returns`
-   `DailyProfitReports`
-   `DailyProfitReportItems`

### 6.8 Operations and audit

-   `BackgroundJobs`
-   `IntegrationLogs`
-   `WebhookEvents`
-   `OutboxMessages`
-   `AuditLogs`

### 6.9 Data design guidelines

1.  Use stable primary keys and unique constraints for external
    identifiers.
2.  Use marketplace + ASIN uniqueness where appropriate.
3.  Store timestamps in UTC; render in the user's configured timezone.
4.  Store monetary values using `NUMERIC`/decimal types, never
    floating-point types.
5.  Store currency codes explicitly with monetary values.
6.  Store raw provider payloads selectively, with retention limits and
    sensitive-data controls.
7.  Keep current snapshots separate from historical observations.
8.  Partition high-volume time-series/history tables by month only when
    volume justifies it.
9.  Add indexes based on measured query patterns; avoid indexing every
    column.
10. Use bulk inserts/upserts for large discovery runs. Prisma has no
    bulk upsert; use raw `INSERT … ON CONFLICT` (or `COPY` into a
    staging table) for 100k-row batches.
11. Record only meaningful price changes where possible, while retaining
    enough observations for audit and trend analysis.
12. Use transactions for order, purchase, shipment, and financial state
    transitions.
13. Use optimistic concurrency or explicit state-transition checks to
    prevent conflicting updates.
14. Implement idempotency keys for inbound webhooks and externally
    triggered operations.
15. Keep buyer PII in separate encrypted storage so it can be purged on
    the DPP retention schedule without deleting orders or financial
    records.

------------------------------------------------------------------------

## 7. Railway deployment plan

Use Railway initially to reduce infrastructure and operational overhead.

### 7.1 Initial Railway services

-   `web`: Next.js frontend
-   `api`: NestJS API with Fastify adapter
-   Worker services, initially grouped by workload if economical:
    -   Research/enrichment workers
    -   Pricing/inventory/listing workers
    -   Order/purchasing/warehouse/shipping workers
    -   Reporting workers
-   Railway PostgreSQL
-   Railway Redis
-   External: one AWS account with SQS queues for SP-API notifications
    only (see 4.4), polled by the notifications worker

Split worker groups into more services only when throughput, resource
isolation, or reliability requires it.

### 7.2 Environments and networking

-   Separate staging and production environments.
-   Use Railway private networking for internal service communication
    where supported.
-   Keep PostgreSQL and Redis private; do not expose database ports
    publicly without a specific need.
-   Store secrets in Railway environment variables or an appropriate
    secret manager.
-   Use least-privilege credentials for each integration.
-   Configure health checks and graceful shutdown.
-   Use persistent/object storage for generated reports and documents;
    do not rely on a container's local filesystem for durable files.
-   Configure database backups and point-in-time recovery where
    available on the selected plan.
-   Regularly test database restore procedures.
-   Configure Redis persistence/availability according to the chosen
    Railway offering and the consequences of queue data loss. Critical
    business state must remain recoverable from PostgreSQL.

### 7.3 Cost and scaling strategy

-   Begin with modest worker concurrency and scale based on measured
    queue age and processing latency.
-   Use separate worker processes so expensive workloads do not starve
    order processing.
-   Batch database writes and provider calls where supported.
-   Avoid unnecessary polling and redundant history writes.
-   Cache reference data and recent product data with explicit TTLs.
-   Set Railway usage alerts and monitor CPU, memory, database storage,
    network egress, and Redis usage.
-   Do not introduce Kubernetes or additional cloud services until a
    measured requirement justifies them.
-   Review Railway's current pricing and resource limits before
    production budgeting; prices and included usage can change.

------------------------------------------------------------------------

## 8. Security, reliability, and compliance

### Security

-   TLS for external traffic and secure service-to-service
    communication.
-   Encrypt secrets and never commit credentials to source control.
-   Use role-based access control and least privilege.
-   Protect customer/order/address data and restrict access.
-   Redact tokens, credentials, and personal data from logs.
-   Validate all API input and provider responses.
-   Apply request throttling and abuse protection.
-   Maintain audit logs for sensitive actions, pricing changes, listing
    submissions, and order operations.

### Reliability

-   Design for retries, duplicate events, provider outages, and partial
    failures.
-   Use idempotency for webhooks and job handlers.
-   Reconcile internal state against Amazon and carrier state.
-   Maintain provider circuit breakers and backoff.
-   Separate estimated values from confirmed/settled financial values.
-   Provide operational dashboards for queue backlog, failed jobs, API
    quota, stale data, and integration health.
-   Define backup, restore, incident response, and recovery procedures.
-   Do not promise 100% uptime; define realistic service objectives and
    recovery targets. Proposed starting targets: order intake and
    inventory zeroing recover within 15 minutes of an outage, and no
    order is lost (SQS retains notifications and reconciliation catches
    anything missed).
-   Fail safe: if FX, stock, or pricing data goes stale beyond its
    threshold, stop repricing and reduce affected inventory to 0 rather
    than publishing from bad data.

### Amazon and legal compliance

-   Use authorized APIs and comply with provider terms and rate limits.
-   Follow Amazon seller, dropshipping, listing, pricing, and
    customer-service policies.
-   Do not evade approval/gating or create false compliance
    declarations. Approval requests are submitted by an operator using
    owner-approved standing attestations (2.6.1).
-   Do not scrape Amazon pages, automate Seller Central, or automate
    retail checkout on amazon.com. The client has agreed to this
    boundary.
-   Comply with the SP-API Acceptable Use Policy and Data Protection
    Policy (DPP); register the developer application with the restricted
    roles it needs and pass any required security assessment.
-   Protect customer data under the privacy laws that actually apply:
    Canada's PIPEDA (and Quebec's Law 25 for Quebec customers) and
    Mexico's federal personal data protection law. GDPR applies only if
    EU residents' data is processed.
-   Comply with tax, customs, product-labeling, and
    consumer-protection requirements in the US, Canada, and Mexico,
    including amazon.com.mx tax withholding and the registration (RFC)
    decision.
-   Obtain qualified advice on cross-border tax, import/export, customs,
    and the proposed sourcing/fulfillment model.

------------------------------------------------------------------------

## 9. Suggested implementation phases

### Phase 0 --- Discovery and technical validation

-   Confirm seller-account structure and marketplace permissions.
-   Confirm Keepa subscription/API limits and required data fields.
    Measure: storefront ASIN coverage for a large CA and a large MX
    seller, MX data freshness, and token cost per product per refresh.
-   **Measure US stock observability:** for a sample of matched
    products, what share return a numeric stock estimate, a
    stock-status signal only, or nothing (2.5).
-   Measure CA/MX ↔ US ASIN match rate and accuracy on a sample.
-   Validate SP-API access, roles (including the restricted role for
    buyer PII), marketplace coverage, and quotas. Register the
    developer application and complete the DPP requirements.
-   Apply for Amazon Business and the Amazon Business Ordering API;
    confirm coupon support and tax exemption.
-   Test the Listings Restrictions API on a sample of ASINs to estimate
    the share that is unrestricted, attestation-gated, or
    document-gated.
-   Validate the sourcing, warehouse, and dropshipping-policy model.
-   Confirm shipping routes, carriers/consolidators, customs, duty, and
    tax responsibilities, including amazon.com.mx withholding and the
    RFC decision. Obtain carrier quotes to build the first rate cards.
-   Decide the returns model for each marketplace.
-   Set realistic handling times from measured purchase → warehouse →
    dispatch times.
-   Create architecture decisions and initial threat model.
-   Establish Railway staging environment and CI/CD.

**Exit criteria:** External API access and the end-to-end business model
are validated; major compliance and cost risks are documented.

### Phase 1 --- Platform foundation

-   Create pnpm/Turborepo monorepo.
-   Set up Next.js frontend and NestJS/Fastify API.
-   Set up PostgreSQL, Prisma, migrations, Redis, and BullMQ.
-   Add authentication, roles, configuration validation, logging,
    tracing, and error monitoring.
-   Create CI pipeline, automated tests, Docker builds, and Railway
    deployment.
-   Implement audit logging and integration-log foundations.

**Exit criteria:** A deployable staging platform exists with
authentication, database migrations, health checks, and observability.

### Phase 2 --- Product research

-   Implement Keepa provider client and quota/token-budget handling.
-   Implement seller-storefront discovery on amazon.ca/amazon.com.mx
    and category/subcategory traversal.
-   Implement resumable discovery runs and deduplication.
-   Implement US enrichment and CA/MX ↔ US product matching with a
    review queue for low-confidence matches.
-   Implement eligibility filters, including hazmat and
    import-restriction filters.
-   Build product research UI with filters, status, and job progress.

**Exit criteria:** Large research runs can be started,
paused/interrupted, resumed, and audited without losing completed work.

### Phase 3 --- Pricing and FX

-   Implement CurrencyAPI provider abstraction.
-   Implement marketplace/category fee configuration, tax withholding
    rules, duty rules, and returns allowance.
-   Implement shipping rate cards, reference destinations, and
    dimensional-weight calculation.
-   Implement pricing formula and unit-tested decimal calculations.
-   Implement competitor monitoring via SP-API notifications (SQS) and
    the Product Pricing API; Keepa for unlisted products.
-   Decide between in-house undercut logic and publishing min/max
    prices to Amazon Automate Pricing or an existing repricer
    (2.3.2).
-   Implement minimum profit/margin safeguards and price-change history.
-   Initially provide a dry-run mode; require review before live price
    publication.

**Exit criteria:** Pricing results are reproducible, explainable, and
validated against manually calculated test cases.

### Phase 4 --- Inventory and listings

-   Implement inventory snapshots, stock signal levels, and buffer
    rules.
-   Implement inventory sync with reconciliation and idempotency, using
    JSON listings feeds for bulk updates.
-   Implement Listings Restrictions checks and the three-way
    unrestricted / attestation-gated / ineligible classification.
-   Implement offer-only listing submission with handling time and
    shipping templates.
-   Implement standing attestations and the operator approval queue
    (grouped by brand/category, with Seller Central deep links).
-   Implement listing status monitoring and error remediation.

**Exit criteria:** Eligible products can be listed and inventory can be
safely synchronized in a controlled test environment.

### Phase 5 --- Orders and purchasing

-   Implement order notifications (SQS) and scheduled reconciliation.
-   Implement order/item state machine and encrypted buyer-PII storage
    with scheduled purging.
-   Implement supplier purchasing through the Amazon Business Ordering
    API, with the operator purchase queue as fallback, and purchase
    tracking.
-   Implement purchasing option evaluation using cost and delivery
    estimates.
-   Add duplicate-order/event protection and exception handling.

**Exit criteria:** Test orders can be received, mapped, and progressed
through the purchasing workflow with full audit history.

### Phase 6 --- Warehouse and shipping

-   Implement inbound parcel tracking and receiving.
-   Implement item matching, inspection, consolidation, and repacking
    workflow.
-   Integrate first carrier(s), labels, and tracking (Amazon Buy
    Shipping where available, then a cross-border consolidator).
-   Implement outbound shipment confirmation to Amazon.
-   Add exception and returns workflows.

**Exit criteria:** A complete test order can be traced from supplier
purchase through warehouse receipt to outbound delivery tracking.

### Phase 7 --- Financial reporting

-   Ingest actual marketplace fees, refunds, and adjustments where
    available.
-   Implement order-level and daily profitability calculations.
-   Distinguish estimated from settled costs.
-   Implement daily report generation and email delivery.
-   Add report history and rerun support.

**Exit criteria:** Daily reports reconcile to source transactions within
documented timing and rounding tolerances.

### Phase 8 --- Production hardening and rollout

-   Load and soak testing.
-   Security review and dependency scanning.
-   Backup/restore test.
-   Queue failure and provider-outage simulations.
-   Monitoring dashboards and alert thresholds.
-   Operational runbooks and support procedures.
-   Gradual rollout: amazon.ca first with a small product cohort, then
    larger cohorts, then amazon.com.mx once Canada metrics (late
    shipment, cancellation, profit vs estimate) are within targets.

**Exit criteria:** Production readiness checklist is approved and
rollback/recovery procedures are tested.

------------------------------------------------------------------------

## 10. Testing strategy

### Unit tests

Cover:

-   Pricing formula, fee calculations, FX conversion, rounding
-   Inventory buffer calculations
-   Eligibility and filtering rules
-   Order and shipment state transitions
-   Idempotency behavior
-   Retry/backoff decisions
-   Profit and margin calculations

### Integration tests

Cover:

-   PostgreSQL/Prisma repositories and transactions
-   Redis/BullMQ job lifecycle
-   Keepa client response mapping and quota errors
-   SP-API client behavior and throttling
-   Currency and carrier provider adapters
-   Webhook verification and duplicate delivery

Use mocked/sandbox providers where available. Never run destructive
tests against production seller accounts.

### End-to-end tests

Cover:

-   Login and permissions
-   Product research workflow
-   Product eligibility and pricing review
-   Inventory update
-   Listing and approval workflow
-   Order intake through warehouse and shipping
-   Daily report generation

### Non-functional tests

-   Large discovery batches and database write throughput
-   Queue backlog recovery
-   API rate-limit behavior
-   Provider outage and recovery
-   Worker restart during active jobs
-   Database restore and application recovery
-   Security and authorization boundaries

------------------------------------------------------------------------

## 11. Operational dashboards and alerts

At minimum, monitor:

-   API availability and latency
-   Worker health and restart count
-   Queue depth, oldest job age, retries, and failures
-   Keepa and SP-API quota/throttle events
-   Stale product, FX, competitor, and inventory data
-   Failed or delayed inventory/listing updates
-   Orders stuck in a state beyond a configured threshold
-   Supplier purchases not received by expected date
-   Warehouse exceptions
-   Shipments without tracking updates
-   Financial reconciliation differences
-   Daily report generation and email failures
-   PostgreSQL storage, connections, slow queries, and backup status
-   Redis memory and availability

Provide a secure admin view to inspect and replay eligible failed jobs,
with audit logging.

------------------------------------------------------------------------

## 12. Initial acceptance criteria

The first production release should not be considered complete until:

1.  Product discovery can process large datasets with resumable progress
    and deduplication.
2.  Product data includes provenance and freshness metadata.
3.  Pricing is deterministic, decimal-safe, configurable, and auditable.
4.  No price can be published below configured safety floors.
5.  Inventory buffer logic is tested and reconciled against marketplace
    state.
6.  Listing approvals are handled through legitimate, auditable
    workflows.
7.  Orders and webhook events are idempotent.
8.  Warehouse and shipment state transitions are traceable.
9.  Financial reports distinguish estimates from actual/settled amounts.
10. Failed jobs can be diagnosed and safely retried.
11. Secrets and customer data are protected.
12. Staging, backups, restore, monitoring, and operational runbooks are
    in place.
13. Amazon and carrier integrations have been validated with the
    relevant accounts and supported API capabilities.
14. The full workflow has been tested with representative US, Canada,
    and Mexico scenarios.
15. Only confirmed CA/MX ↔ US product matches can be priced and listed.
16. Every listing has a handling time based on measured fulfillment
    times.
17. Buyer PII handling meets the Amazon Data Protection Policy,
    including scheduled purging.
18. Each approval submission can be traced to an owner-approved
    standing attestation and the operator who submitted it.

------------------------------------------------------------------------

## 13. Instructions for the AI development agent

Follow these rules throughout implementation:

1.  **Use only the selected stack:** React, Next.js, TypeScript,
    Node.js, NestJS, Fastify adapter, PostgreSQL, Prisma, Redis, BullMQ,
    and Railway.
2.  Do not introduce .NET, C#, Angular, RabbitMQ, Kubernetes, or another
    infrastructure platform unless the project owner explicitly approves
    a change. The one approved exception is AWS SQS, used only as the
    SP-API notification destination (4.4).
3.  Prefer a modular monolith plus separately deployed workers over
    premature microservices.
4.  Keep business logic independent of external providers. Use
    interfaces/adapters for Keepa, Amazon, FX, carriers, email, and
    storage.
5.  Treat PostgreSQL as the source of truth. Redis is for caching and
    queues, not authoritative business state.
6.  Use decimal-safe arithmetic for all financial calculations.
7.  Validate environment variables at startup and fail clearly when
    required configuration is missing.
8.  Never hard-code secrets, marketplace IDs, fee rates, FX rates, or
    business thresholds.
9.  Implement idempotency, retries, backoff, rate limiting, and
    reconciliation for all external integrations.
10. Add unit tests for business rules and integration tests for
    persistence, queues, and provider adapters.
11. Use migrations for all database changes. Never make undocumented
    manual production schema changes.
12. Add structured logs, correlation IDs, metrics, and traces.
13. Make long-running work asynchronous and expose progress/status to
    the UI.
14. Keep API contracts documented with OpenAPI.
15. Add authorization checks to every sensitive endpoint and admin
    action.
16. Record audit history for financial, listing, inventory, order, and
    configuration changes.
17. Do not invent provider capabilities. Verify current API
    documentation, account permissions, marketplace coverage, quotas,
    and terms before implementing.
18. Do not bypass Amazon approval processes or submit unverified
    compliance declarations. Do not write scrapers for Amazon pages,
    browser automation for Seller Central, or checkout automation for
    amazon.com retail accounts.
19. Build in small phases. At the end of each phase, run tests, update
    documentation, and report completed work, limitations, and next
    tasks.
20. Before adding a dependency or cloud service, explain why it is
    needed and estimate its operational/cost impact.
21. Prefer simple, maintainable solutions that can scale through
    measured increases in worker concurrency and service resources.
22. Do not claim a feature is complete until its acceptance criteria and
    tests pass.

------------------------------------------------------------------------

## 14. Decisions still requiring owner confirmation

**Resolved (Revision 2):**

-   Compliance boundaries: no scraping, no Seller Central automation, no
    retail-checkout automation; approvals submitted by an operator using
    owner-approved standing attestations. Agreed by the client.
-   Supplier purchasing: Amazon Business Ordering API, with an operator
    purchase queue as fallback.
-   Rollout order: amazon.ca first, then amazon.com.mx.

**Still open — resolve before or during Phase 0:**

-   Exact Amazon seller-account and buyer-account structure.
-   Warehouse location(s), operating hours, receiving process, and
    consolidation rules; meaning of the "Canada/Mexico warehouse →
    border warehouse" transfer in the client requirements.
-   Exact shipping lanes and carrier/consolidator accounts for US →
    Canada and US → Mexico.
-   Tax, customs, import/export, and importer-of-record
    responsibilities; whether to register for an RFC in Mexico.
-   Returns model per marketplace (local return address, prepaid
    labels, or returnless refunds).
-   Shipping reference destinations: farthest point everywhere, or
    farthest point within served regions with remote regions excluded.
-   Inventory fallback quantities when only a stock-status signal is
    available.
-   In-house undercut logic vs Amazon Automate Pricing / existing
    repricer.
-   Keepa plan, quotas, and precise required data fields.
-   SP-API roles, application approval, and marketplace permissions.
-   Authentication provider and user/role model.
-   Email provider and report recipients.
-   Product/category exclusions and eligibility thresholds.
-   Pricing policy: markup vs target margin, minimum profit, competitor
    undercut, and price floors.
-   Inventory buffer defaults and override hierarchy.
-   Data retention, customer-data privacy, and audit requirements.
-   Railway plan/resource budget and expected product/order volumes.

------------------------------------------------------------------------

## 15. Recommended first milestone

Start with a vertical slice that proves the platform's most important
technical and business assumptions:

1.  Deploy the monorepo to Railway staging.
2.  Connect Keepa and discover a controlled batch of products from one
    or two real seller IDs on amazon.ca.
3.  Match them to amazon.com products and record match confidence and
    the available stock signal.
4.  Persist products, matches, and marketplace observations in
    PostgreSQL.
5.  Check listing restrictions for the batch through SP-API and show
    the unrestricted / attestation-gated / ineligible split.
6.  Calculate a simulated Canada target price using configurable FX,
    fee, rate-card, and duty assumptions.
7.  Calculate target inventory using the configurable buffer and stock
    signal level.
8.  Display research results, match status, restriction status, price
    breakdown, and inventory recommendation in the React UI.
9.  Run the workflow through BullMQ with resumability, retries, and
    observability.

This milestone also produces the Phase 0 measurements (match rate,
stock observability, restriction split, Keepa token cost) on real data.

Do not enable automatic listing, live repricing, or purchasing until the
product data, calculations, seller permissions, policy requirements, and
operational controls have been validated.

------------------------------------------------------------------------

**End of consolidated implementation brief.**
