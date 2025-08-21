// This 100% shouldn't be a monolithic file.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DataTable from 'react-data-table-component';
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User
} from "firebase/auth";
import { auth } from './firebase';
import './App.css';

// ========================================================================
// IMPORTANT: Replace with your Firebase Functions base URL.
const API_BASE_URL = 'http://127.0.0.1:5001/PROJECT_ID/SERVER/api';
// ========================================================================

// TypeScript Types
type SubscriptionType = 'zip' | 'parcel' | 'ward' | 'neighborhood';
type Alerts = Record<SubscriptionType, (string | number)[]>;
type Property = Record<string, any>;

// Helper Function
const toTitleCase = (str: string) => {
  if (!str) return '';
  const result = str.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return result.replace(/\b\w/g, char => char.toUpperCase());
};

// ============================================================================
// Centralized API Service
// ============================================================================
const api = {
  _authorizedRequest: async (url: string, options: RequestInit = {}) => {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error("User not authenticated.");

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`,
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "An API error occurred.");
    }
    return response.json();
  },
  syncGoogleUser: (idToken: string) => fetch(`${API_BASE_URL}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  }).then(res => res.json()),
  registerUser: (name: string, email: string, password: string) => fetch(`${API_BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  }).then(res => res.json()),
  fetchProfile: () => api._authorizedRequest(`${API_BASE_URL}/auth/profile`),
  getAlerts: () => api._authorizedRequest(`${API_BASE_URL}/alerts`),
  createAlert: (type: SubscriptionType, value: string | number) => api._authorizedRequest(`${API_BASE_URL}/alerts`, {
    method: 'POST',
    body: JSON.stringify({ type, value }),
  }),
  deleteAlert: (type: SubscriptionType, value: string | number) => api._authorizedRequest(`${API_BASE_URL}/alerts`, {
    method: 'DELETE',
    body: JSON.stringify({ type, value }),
  }),
  searchProperties: async (searchParams: Record<string, any>) => {
    const query = new URLSearchParams(searchParams).toString();
    const response = await fetch(`${API_BASE_URL}/properties?${query}`);
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch properties.");
    }
    return response.json();
  },
  fetchSelections: () => fetch(`${API_BASE_URL}/properties/selections`).then(res => {
      if (!res.ok) throw new Error('Failed to fetch filter selections.');
      return res.json();
  })
};

// ============================================================================
// Custom Hooks
// ============================================================================
function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser && !isAuthenticating) {
        try {
          // Add a small delay to ensure any sync operations have completed
          await new Promise(resolve => setTimeout(resolve, 500));
          const profileData = await api.fetchProfile();
          setProfile(profileData.user);
        } catch (err: any) {
          if (err.message?.includes('404') || err.message?.includes('not found')) {
            console.log('User not found, retrying in 2 seconds...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            try {
              const profileData = await api.fetchProfile();
              setProfile(profileData.user);
            } catch (retryErr: any) {
              setError(retryErr.message || 'Could not fetch user profile after retry.');
              await signOut(auth);
            }
          } else {
            setError(err.message || 'Could not fetch user profile.');
            await signOut(auth);
          }
        }
      } else {
        setProfile(null);
      }
      setIsLoading(false);
    });
    return () => unsubscribe();
  }, [isAuthenticating]);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return { user, profile, isLoading, error, setError, handleSignOut, setIsAuthenticating };
}

function usePropertySearch() {
  const [results, setResults] = useState<Property[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState({ column: 'address', direction: 'asc' });
  const [currentParams, setCurrentParams] = useState<Record<string, any>>({});

  useEffect(() => {
    const fetchProperties = async () => {
      setIsLoading(true);
      setError('');
      try {
        const allParams = { ...currentParams, page, pageSize, sort: sort.column, order: sort.direction };
        const response = await api.searchProperties(allParams);
        setResults(response.items || []);
        setTotal(response.total || 0);
      } catch (err: any) {
        setError(err.message || "An error occurred during search.");
        setResults([]);
        setTotal(0);
      } finally {
        setIsLoading(false);
      }
    };
    fetchProperties();
  }, [page, pageSize, sort, currentParams]);

  const performSearch = (params: Record<string, any>) => {
    setPage(1);
    setCurrentParams(params);
  };

  return { results, total, isLoading, error, page, pageSize, setPage, setPageSize, setSort, performSearch };
}

function useAlerts(user: User | null) {
    const [alerts, setAlerts] = useState<Alerts | null>(null);
    const [error, setError] = useState('');

    const fetchAlerts = useCallback(async () => {
        if (!user) return;
        try {
            const response = await api.getAlerts();
            setAlerts(response.alerts);
        } catch (err: any) {
            setError(err.message || "Could not fetch alerts.");
        }
    }, [user]);

    useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

    const addAlert = async (type: SubscriptionType, value: string) => {
        setError('');
        if (!value.trim()) {
            setError("Value cannot be empty.");
            return;
        }
        try {
            await api.createAlert(type, value);
            await fetchAlerts();
        } catch (err: any) {
            setError(err.message || "Failed to add alert.");
        }
    };

    const deleteAlert = async (type: SubscriptionType, value: string | number) => {
        setError('');
        try {
            await api.deleteAlert(type, value);
            await fetchAlerts();
        } catch (err: any) {
            setError(err.message || "Failed to delete alert.");
        }
    };

    return { alerts, error, addAlert, deleteAlert };
}

// ============================================================================
// Components
// ============================================================================

function App() {
  const { user, profile, isLoading, error, setError, handleSignOut, setIsAuthenticating } = useAuth();

  if (isLoading) {
    return <div className="container"><p>Loading...</p></div>;
  }

  return (
    <div className="container">
      <h1>STL LRA Property Monitor</h1>
      <p>This is a dashboard for monitoring properties owned by the St. Louis Land Reutilization Authority.</p>
      <p>Set alerts by Zip Code, Parcel ID, or Ward and be notified of daily changes.</p>
      <br></br>
      {error && <p className="error">{error}</p>}
      {user && profile ? (
        <Dashboard user={user} profile={profile} onSignOut={handleSignOut} />
      ) : (
        <AuthForm setError={setError} setIsAuthenticating={setIsAuthenticating} />
      )}
    </div>
  );
}

function Dashboard({ user, profile, onSignOut }: { user: User, profile: any, onSignOut: () => void }) {
  const { alerts, error: alertsError, addAlert, deleteAlert } = useAlerts(user);
  const { results, total, isLoading: isSearchLoading, error: searchError, page, pageSize, setPage, setPageSize, setSort, performSearch } = usePropertySearch();

  const alertEntries = useMemo(() => 
    alerts ? Object.entries(alerts).flatMap(([type, values]) => 
      values.map(value => ({ type: type as SubscriptionType, value }))
    ) : [], [alerts]);

  const displayName = profile?.name || user.displayName || user.email;

  return (
    <div>
      <div className="header">
        <h2>Welcome, {displayName}</h2>
        <button onClick={onSignOut}>Sign Out</button>
      </div>
      <p>Email: {user.email}</p>

      <hr />

      <h3>Manage Your Alerts</h3>
      {alertsError && <p className="error">{alertsError}</p>}
      <AddAlertForm onAddAlert={addAlert} />
      
      <h4>Your Active Alerts:</h4>
      {alertEntries.length > 0 ? (
        <div className="alerts-table">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Value</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {alertEntries.map(({ type, value }) => (
                <tr key={`${type}-${value}`}>
                  <td>{toTitleCase(type)}</td>
                  <td>{value}</td>
                  <td><button onClick={() => deleteAlert(type, value)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{alerts ? "You have no active alerts." : "Loading alerts..."}</p>
      )}

      <hr />
      
      {/* Two-column layout for search and results */}
      <div className="main-content-layout">
        <div className="left-sidebar">
          <PropertySearch onSearch={performSearch} isLoading={isSearchLoading} />
        </div>
        <div className="right-content">
          {searchError && <p className="error">{searchError}</p>}
          <ResultsDisplay 
            results={results} 
            total={total} 
            isLoading={isSearchLoading}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onRowsPerPageChange={(newSize, newPage) => { setPageSize(newSize); setPage(newPage); }}
            onSort={(column: any, direction: 'asc' | 'desc') => setSort({ column: column.sortField, direction })}
          />
        </div>
      </div>
    </div>
  );
}

function QueryDisplay({ params }: { params: Record<string, any> }) {
  const displayParams = Object.entries(params)
    .filter(([_, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== '' && value !== null && value !== undefined;
    })
    .map(([key, value]) => {
      let displayValue = value;
      if (Array.isArray(value)) {
        displayValue = value.join(', ');
      }
      return [toTitleCase(key), displayValue];
    });

  if (displayParams.length === 0) {
    return (
      <div className="query-display">
        <h4>Current Search Parameters:</h4>
        <p><em>No filters applied</em></p>
      </div>
    );
  }

  return (
    <div className="query-display">
      <h4>Current Search Parameters:</h4>
      <ul>
        {displayParams.map(([key, value]) => (
          <li key={key}><strong>{key}:</strong> {value}</li>
        ))}
      </ul>
    </div>
  );
}

// Filter menu component for better UX
function FilterDropdown({ 
  label, 
  options, 
  selectedValues, 
  onSelectionChange, 
  isLoading,
  placeholder = "Select options..."
}: {
  label: string;
  options: (string | number)[];
  selectedValues: (string | number)[];
  onSelectionChange: (values: (string | number)[]) => void;
  isLoading: boolean;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  const filteredOptions = options.filter(option => 
    option.toString().toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleOption = (option: string | number) => {
    const isSelected = selectedValues.includes(option);
    if (isSelected) {
      onSelectionChange(selectedValues.filter(v => v !== option));
    } else {
      onSelectionChange([...selectedValues, option]);
    }
  };

  const clearAll = () => {
    onSelectionChange([]);
  };

  return (
    <div className="filter-dropdown">
      <div className="filter-label-container">
        <label>{label}</label>
        {selectedValues.length > 0 && (
          <button 
            type="button" 
            onClick={clearAll}
            className="clear-filter-btn"
          >
            Clear ({selectedValues.length})
          </button>
        )}
      </div>
      
      <div className="filter-dropdown-container">
        <button
          type="button"
          className={`filter-dropdown-trigger ${isOpen ? 'open' : ''}`}
          onClick={() => setIsOpen(!isOpen)}
          disabled={isLoading}
        >
          <span>
            {selectedValues.length > 0 
              ? `${selectedValues.length} selected` 
              : placeholder
            }
          </span>
          <span className="dropdown-arrow">▼</span>
        </button>
        
        {isOpen && (
          <div className="filter-dropdown-menu">
            <div className="filter-search">
              <input
                type="text"
                placeholder={`Search ${label.toLowerCase()}...`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="filter-search-input"
              />
            </div>
            
            <div className="filter-options">
              {filteredOptions.length > 0 ? (
                filteredOptions.map(option => (
                  <label key={option} className="filter-option">
                    <input
                      type="checkbox"
                      checked={selectedValues.includes(option)}
                      onChange={() => toggleOption(option)}
                    />
                    <span className="checkmark"></span>
                    <span className="option-text">
                      {typeof option === 'number' && label === 'Wards' ? `Ward ${option}` : option}
                    </span>
                  </label>
                ))
              ) : (
                <div className="no-options">No {label.toLowerCase()} found</div>
              )}
            </div>
          </div>
        )}
      </div>
      
      {selectedValues.length > 0 && (
        <div className="selected-filters">
          {selectedValues.map(value => (
            <span key={value} className="filter-tag">
              {typeof value === 'number' && label === 'Wards' ? `Ward ${value}` : value}
              <button 
                type="button"
                onClick={() => toggleOption(value)}
                className="remove-filter"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PropertySearch({ onSearch, isLoading }: { onSearch: (params: Record<string, any>) => void, isLoading: boolean }) {
  const [params, setParams] = useState({
    query: '', neighborhood: [] as string[], zip: [] as string[], status: [] as string[],
    propertyType: '', usage: [] as string[], sqftMin: '', sqftMax: '', ward: [] as number[]
  });
  const [selections, setSelections] = useState<{ 
    knownZips: string[], 
    knownNeighborhoods: string[], 
    knownWards: number[], 
    knownUsages: string[], 
    knownStatuses: string[], 
  }>({
    knownZips: [], 
    knownNeighborhoods: [], 
    knownWards: [], 
    knownUsages: [], 
    knownStatuses: [], 
  });
  const [isLoadingSelections, setIsLoadingSelections] = useState(true);

  useEffect(() => { 
    api.fetchSelections()
      .then(setSelections)
      .catch(error => console.error("Error fetching selections:", error))
      .finally(() => setIsLoadingSelections(false));
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setParams({ ...params, [e.target.name]: e.target.value });
  };

  const handleFilterChange = (fieldName: keyof typeof params, selectedOptions: (string | number)[]) => {
    setParams({ ...params, [fieldName]: selectedOptions });
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const cleanedParams = {
      ...params,
      zip: Array.isArray(params.zip) ? params.zip.join(',') : params.zip,
      neighborhood: Array.isArray(params.neighborhood) ? params.neighborhood.join(',') : params.neighborhood,
      ward: Array.isArray(params.ward) ? params.ward.join(',') : params.ward,
      usage: Array.isArray(params.usage) ? params.usage.join(',') : params.usage,
      status: Array.isArray(params.status) ? params.status.join(',') : params.status,
    };
    const cleanParams = Object.fromEntries(Object.entries(cleanedParams).filter(([_, v]) => v));
    onSearch(cleanParams);
  };

  const clearAllFilters = () => {
    setParams({
      query: '', neighborhood: [], zip: [], status: [],
      propertyType: '', usage: [], sqftMin: '', sqftMax: '', ward: []
    });
  };

  const hasActiveFilters = params.neighborhood.length > 0 || params.zip.length > 0 || 
    params.status.length > 0 || params.usage.length > 0 || params.ward.length > 0 ||
    params.sqftMin || params.sqftMax;
  
  return (
    <div className="search-sidebar">
      <h3>Search & Filters</h3>
      <form onSubmit={handleSubmit}>
        <div className="search-query-container">
          <label>Search Address or Parcel ID:</label>
          <input 
            name="query" 
            type="text" 
            value={params.query} 
            onChange={handleChange} 
            placeholder="Enter address or parcel ID" 
            className="search-input"
          />
        </div>
        
        {hasActiveFilters && (
          <div className="clear-filters-container">
            <button 
              type="button" 
              onClick={clearAllFilters}
              className="clear-all-filters-btn"
            >
              Clear All Filters
            </button>
          </div>
        )}
        
        <div className="filters-panel-sidebar">
          <div className="filters-grid-sidebar">
            <FilterDropdown
              label="Neighborhoods"
              options={selections.knownNeighborhoods}
              selectedValues={params.neighborhood}
              onSelectionChange={(values) => handleFilterChange('neighborhood', values)}
              isLoading={isLoadingSelections}
              placeholder="Select neighborhoods..."
            />
            
            <FilterDropdown
              label="ZIP Codes"
              options={selections.knownZips}
              selectedValues={params.zip}
              onSelectionChange={(values) => handleFilterChange('zip', values)}
              isLoading={isLoadingSelections}
              placeholder="Select ZIP codes..."
            />
            
            <FilterDropdown
              label="Status"
              options={selections.knownStatuses}
              selectedValues={params.status}
              onSelectionChange={(values) => handleFilterChange('status', values)}
              isLoading={isLoadingSelections}
              placeholder="Select statuses..."
            />
            
            <FilterDropdown
              label="Usage"
              options={selections.knownUsages}
              selectedValues={params.usage}
              onSelectionChange={(values) => handleFilterChange('usage', values)}
              isLoading={isLoadingSelections}
              placeholder="Select usages..."
            />
            
            <FilterDropdown
              label="Wards"
              options={selections.knownWards}
              selectedValues={params.ward}
              onSelectionChange={(values) => handleFilterChange('ward', values)}
              isLoading={isLoadingSelections}
              placeholder="Select wards..."
            />
            
            <div className="sqft-range-filter">
              <label>Square Footage Range</label>
              <div className="sqft-inputs">
                <input 
                  name="sqftMin" 
                  type="number" 
                  value={params.sqftMin} 
                  onChange={handleChange} 
                  placeholder="Min sqft" 
                  min="0" 
                />
                <span className="range-separator">to</span>
                <input 
                  name="sqftMax" 
                  type="number" 
                  value={params.sqftMax} 
                  onChange={handleChange} 
                  placeholder="Max sqft" 
                  min="0" 
                />
              </div>
            </div>
          </div>
        </div>
        
        <div className="search-actions">
          <button type="submit" disabled={isLoading || isLoadingSelections} className="search-btn">
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>
      <QueryDisplay params={params} />
    </div>
  );
}




// ============================================================================
// MODIFIED: ResultsDisplay Component
// ============================================================================
function ResultsDisplay({ results, total, isLoading, page, pageSize, onPageChange, onRowsPerPageChange, onSort }: {
  results: Property[], total: number, isLoading: boolean, page: number, pageSize: number,
  onPageChange: (page: number) => void,
  onRowsPerPageChange: (newSize: number, page: number) => void,
  onSort: (column: any, sortDirection: 'asc' | 'desc') => void,
}) {
    const [manualPageInput, setManualPageInput] = useState(page.toString());
    const totalPages = Math.ceil(total / pageSize);

    useEffect(() => {
        setManualPageInput(page.toString());
    }, [page]);

    const handleManualPageSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const numPage = parseInt(manualPageInput, 10);

        if (!isNaN(numPage) && numPage >= 1 && numPage <= totalPages) {
            onPageChange(numPage);
        } else {
             // If input is invalid, reset it to the current page to avoid confusion
            setManualPageInput(page.toString());
        }
    };
    
    const allowedKeys = ['parcelId', 'address', 'neighborhood', 'ward', 'zip', 'propertyType', 'status', 'sqft', 'lastSaleDate'];
    
    const columns = useMemo(() => {
        if (results.length === 0) return [];
        
        const customDataTypeSort = (rowA: Property, rowB: Property, key: string) => {
            let a = rowA[key]; let b = rowB[key];
            if (a == null) return -1; if (b == null) return 1;
            if (typeof a === 'object' && a._seconds) a = a._seconds;
            if (typeof b === 'object' && b._seconds) b = b._seconds;
            if (typeof a === 'number' && typeof b === 'number') return a - b;
            return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' });
        };

        return Object.keys(results[0])
          .filter(key => allowedKeys.includes(key))
          .map(key => ({
            name: toTitleCase(key),
            selector: (row: Property) => {
                const value = row[key];
                if (key === 'parcelId') {
                    return <a href={`https://www.stlouis-mo.gov/government/departments/sldc/real-estate/lra-owned-property-search.cfm?action=detail&parcelId=${value}`} target="_blank" rel="noopener noreferrer">{value}</a>;
                }
                if (value == null) return 'N/A';
                if (typeof value === 'object' && '_seconds' in value) return new Date(value._seconds * 1000).toLocaleDateString();
                if (typeof value === 'number') return value.toLocaleString();
                return value;
            },
            sortable: true,
            sortField: key,
            sortFunction: (rowA: Property, rowB: Property) => customDataTypeSort(rowA, rowB, key),
        }));
    }, [results]);

    return (
        <div className="results-container">
            <h4>Search Results</h4>
            
            {total > 0 && (
                <form onSubmit={handleManualPageSubmit} className="manual-pagination-controls">
                    <span>Go to page:</span>
                    <input 
                        type="number" 
                        value={manualPageInput} 
                        onChange={(e) => setManualPageInput(e.target.value)}
                        min="1"
                        max={totalPages > 0 ? totalPages : 1}
                        aria-label="Go to page number"
                    />
                    <button type="submit">Go</button>
                </form>
            )}

            <DataTable
                columns={columns}
                data={results}
                progressPending={isLoading}
                pagination
                paginationServer
                paginationTotalRows={total}
                paginationDefaultPage={page}
                onChangeRowsPerPage={onRowsPerPageChange}
                onChangePage={onPageChange}
                sortServer
                onSort={onSort}
                noHeader={columns.length === 0}
            />
        </div>
    );
}

function AddAlertForm({ onAddAlert }: { onAddAlert: (type: SubscriptionType, value: string) => void }) {
  const [type, setType] = useState<SubscriptionType>('zip');
  const [value, setValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAddAlert(type, value);
    setValue('');
  };

  return (
    <form onSubmit={handleSubmit} className="add-alert-form">
      <h4>Add New Alert</h4>
      <div className="input-group">
        <select value={type} onChange={(e) => setType(e.target.value as SubscriptionType)}>
          <option value="zip">ZIP Code</option>
          <option value="parcel">Parcel ID</option>
          <option value="ward">Ward</option>
          <option value="neighborhood">Neighborhood</option>
        </select>
        <input type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder={`Enter ${toTitleCase(type)}...`} required />
        <button type="submit">Add Alert</button>
      </div>
    </form>
  );
}

function AuthForm({ setError, setIsAuthenticating }: { setError: (msg: string) => void, setIsAuthenticating: (isAuth: boolean) => void }) {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleAuthAction = async (action: 'login' | 'signup' | 'google') => {
    setError('');
    setIsLoading(true);
    setIsAuthenticating(true);
    try {
      if (action === 'google') {
        const result = await signInWithPopup(auth, new GoogleAuthProvider());

        const idToken = await result.user.getIdToken();
        await api.syncGoogleUser(idToken);

      } else if (action === 'signup') {
        await api.registerUser(name, email, password);
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
      setIsAuthenticating(false);
    }
  };

  return (
    <div>
      <div className="form-container">
        <h3>{isLogin ? 'Sign In' : 'Register'}</h3>
        {!isLogin && <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" required />
        <div className="button-group">
          <button 
            onClick={() => handleAuthAction(isLogin ? 'login' : 'signup')}
            disabled={isLoading}
          >
            {isLoading ? 'Loading...' : (isLogin ? 'Login' : 'Sign Up')}
          </button>
          <button 
            className="link-button" 
            onClick={() => setIsLogin(!isLogin)}
            disabled={isLoading}
          >
            {isLogin ? 'Need an account? Sign Up' : 'Already have an account? Login'}
          </button>
        </div>
      </div>
      <hr />
      <button 
        onClick={() => handleAuthAction('google')}
        disabled={isLoading}
      >
        {isLoading ? 'Signing in with Google...' : 'Sign in with Google'}
      </button>
    </div>
  );
}

export default App;