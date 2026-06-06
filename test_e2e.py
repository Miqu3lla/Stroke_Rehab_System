import os
import json

# Check current env vars
print("Current Supabase Configuration:")
print(f"SUPABASE_URL: {os.getenv('SUPABASE_URL')}")
print(f"SUPABASE_SERVICE_ROLE_KEY: {os.getenv('SUPABASE_SERVICE_ROLE_KEY')[:20]}..." if os.getenv('SUPABASE_SERVICE_ROLE_KEY') else "SUPABASE_SERVICE_ROLE_KEY: NOT SET")

if not os.getenv("SUPABASE_URL"):
    raise RuntimeError("SUPABASE_URL is not set")
if not os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
    raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not set")

# Test API endpoint
import urllib.request
from urllib import error

data = {
    'first_name': 'Test',
    'last_name': 'PatientE2E',
    'stroke_type': 'ischemic',
    'months_in_recovery': '1 Month',
    'affected_area': 'Arms',
    'affected_side': 'Right'
}

print("\nSending patient profile to /patients endpoint...")
try:
    req = urllib.request.Request(
        'http://localhost:8002/patients',
        data=json.dumps(data).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=10) as response:
        result = json.loads(response.read().decode('utf-8'))
        print(f"\nStatus: {response.status}")
        print(f"\nFull Response:")
        print(json.dumps(result, indent=2))
        
        if result.get('patient_id'):
            print(f"\n✓ SUCCESS: Patient saved with ID {result['patient_id']}")
        else:
            print(f"\n✗ FAILED: {result.get('database')}")
            
except error.HTTPError as e:
    print(f"HTTP Error {e.code}: {e.read().decode('utf-8', errors='ignore')}")
except Exception as e:
    print(f"Error: {e}")
