// Example RollerFlags client implementation (functional style)

/**
 * Create request headers for API calls
 */
function createHeaders(apiKey) {
  return {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };
}

/**
 * Check if a feature flag is enabled for a given context
 */
async function isEnabled(apiUrl, apiKey, flagKey, context = {}) {
  try {
    const response = await fetch(`${apiUrl}/api/evaluate/${flagKey}`, {
      method: 'POST',
      headers: createHeaders(apiKey),
      body: JSON.stringify(context)
    });

    if (!response.ok) {
      console.error(`Failed to evaluate flag ${flagKey}:`, response.statusText);
      return false;
    }

    const data = await response.json();
    return data.enabled;
  } catch (error) {
    console.error(`Error evaluating flag ${flagKey}:`, error);
    return false;
  }
}

/**
 * Evaluate multiple flags at once
 */
async function evaluateMany(apiUrl, apiKey, flagKeys, context = {}) {
  try {
    const response = await fetch(`${apiUrl}/api/evaluate`, {
      method: 'POST',
      headers: createHeaders(apiKey),
      body: JSON.stringify({ flags: flagKeys, context })
    });

    if (!response.ok) {
      console.error('Failed to evaluate flags:', response.statusText);
      return {};
    }

    return await response.json();
  } catch (error) {
    console.error('Error evaluating flags:', error);
    return {};
  }
}

/**
 * Create a new feature flag
 */
async function createFlag(apiUrl, apiKey, flagData) {
  try {
    const response = await fetch(`${apiUrl}/api/flags`, {
      method: 'POST',
      headers: createHeaders(apiKey),
      body: JSON.stringify(flagData)
    });

    if (!response.ok) {
      throw new Error(`Failed to create flag: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating flag:', error);
    throw error;
  }
}

/**
 * Update an existing flag
 */
async function updateFlag(apiUrl, apiKey, flagKey, updates) {
  try {
    const response = await fetch(`${apiUrl}/api/flags/${flagKey}`, {
      method: 'PATCH',
      headers: createHeaders(apiKey),
      body: JSON.stringify(updates)
    });

    if (!response.ok) {
      throw new Error(`Failed to update flag: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error updating flag:', error);
    throw error;
  }
}

/**
 * Get a specific flag by key
 */
async function getFlag(apiUrl, apiKey, flagKey) {
  try {
    const response = await fetch(`${apiUrl}/api/flags/${flagKey}`, {
      headers: createHeaders(apiKey)
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Error getting flag:', error);
    return null;
  }
}

/**
 * Get all flags for the current environment
 */
async function getAllFlags(apiUrl, apiKey) {
  try {
    const response = await fetch(`${apiUrl}/api/flags`, {
      headers: createHeaders(apiKey)
    });

    if (!response.ok) {
      throw new Error(`Failed to get flags: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error getting flags:', error);
    return [];
  }
}

// Usage example
async function main() {
  const apiUrl = 'http://localhost:3000';
  const apiKey = 'rf_xxxxxxxxxxxxxxxxxx'; // Replace with your API key

  // Create a new flag
  const flag = await createFlag(apiUrl, apiKey, {
    key: 'new-feature',
    name: 'New Feature',
    description: 'Our awesome new feature',
    enabled: true
  });
  console.log('Created flag:', flag);

  // Check if feature is enabled for a user
  const enabled = await isEnabled(apiUrl, apiKey, 'new-feature', {
    userId: 'user-123',
    attributes: {
      plan: 'premium',
      region: 'us-west'
    }
  });
  console.log('Is enabled:', enabled);

  // Evaluate multiple flags at once
  const results = await evaluateMany(
    apiUrl,
    apiKey,
    ['new-feature', 'beta-feature', 'experimental'],
    {
      userId: 'user-123',
      attributes: { plan: 'premium' }
    }
  );
  console.log('Batch results:', results);

  // Update a flag (enable percentage rollout)
  await updateFlag(apiUrl, apiKey, 'new-feature', {
    rollout: { percentage: 50 }
  });
  console.log('Updated flag with 50% rollout');

  // Get all flags
  const allFlags = await getAllFlags(apiUrl, apiKey);
  console.log('All flags:', allFlags);
}

// Uncomment to run
// main().catch(console.error);

// Export functions
export {
  createHeaders,
  isEnabled,
  evaluateMany,
  createFlag,
  updateFlag,
  getFlag,
  getAllFlags
};
