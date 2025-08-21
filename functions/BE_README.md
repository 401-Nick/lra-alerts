# LRA Alerts Backend

## Overview

The LRA (Land Reutilization Authority) Alerts backend is a Firebase Cloud Functions-based API built with Express.js and TypeScript. It provides a comprehensive property data management system with real-time alerts, user authentication, and powerful search capabilities for St. Louis property listings.

## 🏗️ Architecture Overview

The backend follows a modular, service-oriented architecture with clear separation of concerns:

```
functions/src/
├── index.ts           # Main entry point and Express app configuration
├── types.d.ts         # Global type definitions
├── auth.middleware.ts # Authentication middleware
├── auth.routes.ts     # Authentication endpoints
├── alerts.routes.ts   # Alert subscription management
├── properties.routes.ts # Property search and filtering
├── debug.routes.ts    # Development and data ingestion utilities
├── alertEngine.ts     # Core alert notification system
└── arcgis.ts         # ArcGIS data integration layer
```

## 🚀 Core Components

### 1. Application Entry Point (`index.ts`)

The main application file that:
- Initializes Firebase Admin SDK
- Configures Express.js with CORS and middleware
- Mounts all API route modules under organized prefixes
- Exports the Cloud Function for deployment

**Key Features:**
- Request logging middleware
- Robust CORS configuration for development and production
- Modular route mounting (`/auth`, `/alerts`, `/debug`, `/properties`)
- 540-second timeout for long-running operations

### 2. Authentication System

#### Authentication Middleware (`auth.middleware.ts`)
- JWT token verification using Firebase Admin Auth
- Bearer token extraction and validation
- User context injection into request objects
- Comprehensive error handling for invalid/expired tokens

#### Authentication Routes (`auth.routes.ts`)
- **`POST /auth/register`**: Email/password user registration
- **`POST /auth/google`**: Google OAuth sign-in/sign-up
- **`GET /auth/profile`**: Protected user profile retrieval
- Automatic Firestore user profile creation and management

<!-- Alerts are held in the user's Firestore document and haven't been fully implemented in the alert engine yet. --> -->
### 3. Alert Engine (`alertEngine.ts`)

A sophisticated notification system that:

#### Core Functionality:
- **Subscription Management**: Create, remove, and retrieve user alerts
- **Event Processing**: Handle property added/changed/removed events
- **Multi-criteria Alerts**: Support for ZIP, parcel, ward, and neighborhood subscriptions
- **Notification Dispatching**: Extensible notification system (Slack webhook ready)

#### Subscription Types:
- `zip`: ZIP code-based alerts
- `parcel`: Specific parcel ID monitoring
- `ward`: Ward-level notifications
- `neighborhood`: Neighborhood-based alerts

#### Alert Triggers:
- **Added**: New properties entering the system
- **Changed**: Existing property modifications
- **Removed**: Properties removed from listings

### 4. Properties Search System (`properties.routes.ts`)

Advanced property search and filtering with:

#### Search Capabilities:
- **Text Search**: Multi-field search across addresses and parcel IDs
- **Faceted Filtering**: ZIP, ward, neighborhood, status, usage filters
- **Range Filtering**: Square footage, acreage, stories, units
- **Sorting & Pagination**: Configurable sorting with efficient pagination

#### API Endpoints:
- **`GET /properties`**: Main search endpoint with extensive filtering
- **`GET /properties/selections`**: Pre-aggregated filter options

#### Technical Features:
- Zod schema validation for type-safe request processing
- Firestore query optimization with index management
- In-memory filtering for complex text searches
- Field selection for bandwidth optimization

### 5. ArcGIS Integration (`arcgis.ts`)

Comprehensive data integration layer providing:

#### Authentication Modes:
- **OAuth**: Client credentials flow with token caching
- **Static Token**: Pre-configured API key support
- **None**: Public endpoint access

#### Data Processing:
- **Field Normalization**: Consistent data structure across varying ArcGIS schemas
- **Type Safety**: Full TypeScript definitions for property data
- **Batch Processing**: Efficient pagination for large datasets
- **CSV Export**: Data export functionality

#### Configuration Management:
- Environment-based configuration
- Flexible field mapping and aliases
- Configurable filtering and pagination

### 6. Debug & Development Tools (`debug.routes.ts`)

Development utilities including:

#### Data Ingestion:
- **`POST /debug/ingest`**: Secure data ingestion from ArcGIS
- **`POST /debug/wipe`**: Collection cleanup for testing
- Change detection with SHA1 content hashing
- Automatic CSV export to Firebase Storage
- Alert trigger integration

#### Features:
- Batch processing with Firestore operation limits
- Progress tracking and detailed logging
- Error recovery and retry mechanisms
- Selection data aggregation for UI filters

## 🛠️ Technology Stack

### Core Technologies:
- **Runtime**: Node.js 22
- **Platform**: Firebase Cloud Functions v2
- **Framework**: Express.js
- **Language**: TypeScript 5.7+
- **Database**: Firestore
- **Storage**: Firebase Storage

### Key Dependencies:
- **firebase-admin**: Firebase server SDK
- **firebase-functions**: Cloud Functions framework
- **axios**: HTTP client for external APIs
- **d3-dsv**: CSV processing
- **zod**: Runtime type validation
- **cors**: Cross-origin resource sharing

## 🔧 Configuration

### Environment Variables:

#### Firebase:
- Standard Firebase configuration via SDK initialization

#### ArcGIS Integration:
- `ARCGIS_LAYER_URL`: ArcGIS service endpoint
- `ARCGIS_AUTH_MODE`: Authentication mode (oauth|static|none)
- `ARCGIS_OAUTH_TOKEN_URL`: OAuth token endpoint
- `ARCGIS_OAUTH_CLIENT_ID`: OAuth client identifier
- `ARCGIS_OAUTH_CLIENT_SECRET`: OAuth client secret
- `ARCGIS_TOKEN`: Static token (when using static mode)
- `ARCGIS_FIELDS`: Custom field selection
- `ARCGIS_PAGE_SIZE`: Pagination size (default: 2000)
- `ARCGIS_BATCH_SIZE`: Batch processing size (default: 500)

#### Application Settings:
- `DEBUG`: Enable debug logging
- `INGEST_SECRET`: Secure key for ingestion endpoints
- `SLACK_WEBHOOK_URL`: Slack notifications endpoint
- `INCLUDE_COMING_SOON`: Include upcoming properties

## 📊 Data Flow

### Property Data Ingestion:
1. **External Trigger** → Debug ingest endpoint
2. **ArcGIS Query** → Fetch property data with authentication
3. **Data Processing** → Normalize and validate property records
4. **Change Detection** → Compare with existing Firestore data
5. **Database Update** → Batch operations for added/changed/removed properties
6. **Alert Processing** → Trigger notifications for subscribed users
7. **Export Generation** → Create CSV exports and update selection data

### User Authentication Flow:
1. **Client Request** → Send credentials or Google token
2. **Token Verification** → Validate with Firebase Auth
3. **Profile Management** → Create/update Firestore user profile
4. **Response** → Return user data and session token

### Property Search Flow:
1. **Request Validation** → Zod schema validation and sanitization
2. **Query Building** → Construct Firestore queries with filters
3. **Search Strategy** → Text search vs. standard filtering
4. **Result Processing** → Sorting, pagination, and field selection
5. **Response** → Return formatted property data

## 🔒 Security

### Authentication & Authorization:
- Firebase JWT token validation
- Protected routes with middleware
- Secret-based protection for administrative endpoints
- CORS policy enforcement

### Data Protection:
- Input validation and sanitization
- SQL injection prevention through parameterized queries
- Rate limiting through Firebase Functions quotas
- Environment-based configuration management

## 📈 Performance Optimizations

### Database:
- Firestore composite indexes for complex queries
- Batch operations for bulk updates (450 operations per batch)
- Efficient pagination with offset/limit
- Field selection to reduce bandwidth

### Caching:
- OAuth token caching with expiration management
- Pre-aggregated selection data for filter options
- Content hashing for change detection

### Error Handling:
- Comprehensive error catching and logging
- Retry mechanisms for external API calls
- Graceful degradation for partial failures
- Detailed error messages for debugging

## 🚀 Deployment

The application is deployed as a Firebase Cloud Function with:
- **Region**: us-central1
- **Timeout**: 540 seconds
- **Runtime**: Node.js 22
- **Memory**: Default allocation
- **Trigger**: HTTPS requests

## 🔍 Monitoring & Debugging

### Logging:
- Structured console logging throughout the application
- Debug mode with detailed operation tracking
- Request/response logging for API endpoints
- Error tracking with stack traces