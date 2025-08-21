# LRA Alerts Frontend

A React-based frontend application for the Land Reutilization Authority (LRA) alerts system, built with TypeScript, Vite, and Firebase Authentication.

## 🏗️ Architecture Overview

This is a single-page application (SPA) that provides property search functionality and alert management for LRA inventory properties. The application follows a component-based architecture with custom hooks for state management.

### Tech Stack

- **Frontend Framework**: React 19.1.1 with TypeScript
- **Build Tool**: Vite 7.1.2
- **Authentication**: Firebase Auth with Google OAuth
- **UI Components**: Custom components with react-data-table-component
- **Styling**: CSS with CSS Custom Properties (CSS Variables)
- **HTTP Client**: Native Fetch API
- **Linting**: ESLint with TypeScript support

## 📁 Project Structure

```
src/
├── App.tsx           # Main application component (monolithic - needs refactoring)
├── App.css           # Component-specific styles
├── index.css         # Global styles and CSS variables
├── main.tsx          # React entry point
├── firebase.ts       # Firebase configuration and auth setup
├── vite-env.d.ts     # Vite type definitions
└── assets/
    └── react.svg     # Static assets
```

## 🧩 Component Architecture

### Main Components

1. **App Component** - Root component handling authentication state
2. **Dashboard Component** - Main authenticated user interface
3. **AuthForm Component** - Login/signup form with Google OAuth
4. **PropertySearch Component** - Advanced search and filtering interface
5. **ResultsDisplay Component** - Paginated property results table
6. **AddAlertForm Component** - Alert creation interface
7. **FilterDropdown Component** - Reusable multi-select filter component

### Custom Hooks

The application uses three main custom hooks for state management:

#### `useAuth()`
- Manages Firebase authentication state
- Handles user profile synchronization with backend
- Provides sign-out functionality
- Automatically retries failed profile fetches

#### `usePropertySearch()`
- Manages property search state and pagination
- Handles search parameters and sorting
- Integrates with backend property API
- Provides error handling for search operations

#### `useAlerts()`
- Manages user alert subscriptions
- Provides CRUD operations for alerts
- Handles alert types: zip, parcel, ward, neighborhood

## 🔌 API Integration

### Centralized API Service

The application uses a centralized `api` object that handles:

- **Authentication**: Automatic JWT token injection
- **Error Handling**: Standardized error responses
- **Endpoints**:
  - `/auth/*` - Authentication and user management
  - `/alerts` - Alert CRUD operations
  - `/properties` - Property search and filtering
  - `/properties/selections` - Filter option data

### Authentication Flow

1. **Firebase Auth** - Handles user authentication
2. **Backend Sync** - Syncs Firebase users with custom backend
3. **JWT Tokens** - Uses Firebase ID tokens for API authorization
4. **Profile Management** - Fetches and manages user profiles

## 🔍 Key Features

### Property Search
- **Advanced Filtering**: Neighborhood, ZIP, status, property type, square footage
- **Full-text Search**: Address and parcel ID search
- **Pagination**: Server-side pagination with customizable page sizes
- **Sorting**: Column-based sorting with custom data type handling

### Alert Management
- **Subscription Types**: ZIP code, parcel, ward, neighborhood alerts
- **Real-time Updates**: Automatic alert synchronization
- **CRUD Operations**: Create, read, delete alert subscriptions

### Authentication
- **Email/Password**: Traditional authentication
- **Google OAuth**: Single sign-on with Google
- **Profile Management**: User profile synchronization

## 🛠️ Development Setup

```bash
# Run Firebase Emulators
firebase emulators:start

# Install dependencies
npm install

# Install dependencies for functions
cd functions
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Build functions
cd functions
npm run build

# Preview production build
npm run preview
```

## 🔧 Configuration

### Environment Variables

The application requires these Vite environment variables:

```env
VITE_API_KEY=your_firebase_api_key
VITE_AUTH_DOMAIN=your_firebase_auth_domain
VITE_PROJECT_ID=your_firebase_project_id
VITE_STORAGE_BUCKET=your_firebase_storage_bucket
VITE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_APP_ID=your_firebase_app_id
```

### Firebase Configuration

Firebase Auth is configured with emulator support for local development:

```typescript
// firebase.ts
connectAuthEmulator(auth, "http://127.0.0.1:9099");
```

## 📋 Current Issues & Technical Debt

### Monolithic Structure
- **Main Issue**: `App.tsx` is 849 lines and contains multiple components
- **Recommendation**: Split into separate component files
- **Impact**: Maintenance, testing, and code organization

### Suggested Refactoring

```
src/
├── components/
│   ├── Auth/
│   │   ├── AuthForm.tsx
│   │   └── AuthForm.css
│   ├── Dashboard/
│   │   ├── Dashboard.tsx
│   │   └── Dashboard.css
│   ├── PropertySearch/
│   │   ├── PropertySearch.tsx
│   │   ├── FilterDropdown.tsx
│   │   └── PropertySearch.css
│   ├── Results/
│   │   ├── ResultsDisplay.tsx
│   │   └── ResultsDisplay.css
│   └── Alerts/
│       ├── AddAlertForm.tsx
│       └── AlertsTable.tsx
├── hooks/
│   ├── useAuth.ts
│   ├── usePropertySearch.ts
│   └── useAlerts.ts
├── services/
│   └── api.ts
└── types/
    └── index.ts
```

## 🔒 Security Considerations

- Firebase Auth handles authentication security
- API endpoints are protected with JWT tokens
- Environment variables are properly prefixed with `VITE_`
- No sensitive data stored in localStorage

## 🚀 Deployment

The application is configured for deployment with:
- **Build Output**: `dist/` directory
- **Static Hosting**: Compatible with Vercel, Netlify, Firebase Hosting
- **Environment**: Production environment variables required
