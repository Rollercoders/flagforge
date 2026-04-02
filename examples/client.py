"""
Example RollerFlags client implementation in Python
"""

import requests
from typing import Dict, List, Optional, Any


class RollerFlagsClient:
    def __init__(self, api_url: str, api_key: str):
        self.api_url = api_url.rstrip('/')
        self.api_key = api_key
        self.headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }

    def is_enabled(self, flag_key: str, context: Optional[Dict[str, Any]] = None) -> bool:
        """
        Check if a feature flag is enabled for the given context
        """
        try:
            response = requests.post(
                f'{self.api_url}/api/evaluate/{flag_key}',
                headers=self.headers,
                json=context or {}
            )

            if not response.ok:
                print(f'Failed to evaluate flag {flag_key}: {response.text}')
                return False

            data = response.json()
            return data['enabled']
        except Exception as e:
            print(f'Error evaluating flag {flag_key}: {e}')
            return False

    def evaluate_many(self, flag_keys: List[str], context: Optional[Dict[str, Any]] = None) -> Dict[str, bool]:
        """
        Evaluate multiple flags at once
        """
        try:
            response = requests.post(
                f'{self.api_url}/api/evaluate',
                headers=self.headers,
                json={
                    'flags': flag_keys,
                    'context': context or {}
                }
            )

            if not response.ok:
                print(f'Failed to evaluate flags: {response.text}')
                return {}

            return response.json()
        except Exception as e:
            print(f'Error evaluating flags: {e}')
            return {}

    def create_flag(self, flag_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Create a new feature flag
        """
        try:
            response = requests.post(
                f'{self.api_url}/api/flags',
                headers=self.headers,
                json=flag_data
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f'Error creating flag: {e}')
            raise

    def update_flag(self, flag_key: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Update an existing flag
        """
        try:
            response = requests.patch(
                f'{self.api_url}/api/flags/{flag_key}',
                headers=self.headers,
                json=updates
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f'Error updating flag: {e}')
            raise

    def get_flag(self, flag_key: str) -> Optional[Dict[str, Any]]:
        """
        Get a specific flag
        """
        try:
            response = requests.get(
                f'{self.api_url}/api/flags/{flag_key}',
                headers=self.headers
            )

            if not response.ok:
                return None

            return response.json()
        except Exception as e:
            print(f'Error getting flag: {e}')
            return None

    def get_all_flags(self) -> List[Dict[str, Any]]:
        """
        Get all flags in the current environment
        """
        try:
            response = requests.get(
                f'{self.api_url}/api/flags',
                headers=self.headers
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            print(f'Error getting flags: {e}')
            return []


# Usage example
def main():
    client = RollerFlagsClient(
        'http://localhost:3000',
        'rf_xxxxxxxxxxxxxxxxxx'  # Replace with your API key
    )

    # Create a new flag
    flag = client.create_flag({
        'key': 'new-feature',
        'name': 'New Feature',
        'description': 'Our awesome new feature',
        'enabled': True
    })
    print('Created flag:', flag)

    # Check if feature is enabled for a user
    enabled = client.is_enabled('new-feature', {
        'userId': 'user-123',
        'attributes': {
            'plan': 'premium',
            'region': 'us-west'
        }
    })
    print('Is enabled:', enabled)

    # Evaluate multiple flags at once
    results = client.evaluate_many(
        ['new-feature', 'beta-feature', 'experimental'],
        {
            'userId': 'user-123',
            'attributes': {'plan': 'premium'}
        }
    )
    print('Batch results:', results)

    # Update a flag (enable percentage rollout)
    client.update_flag('new-feature', {
        'rollout': {'percentage': 50}
    })
    print('Updated flag with 50% rollout')

    # Get all flags
    all_flags = client.get_all_flags()
    print('All flags:', all_flags)


if __name__ == '__main__':
    main()
