import os
import sys
import json

# 1. Path Traversal logic (equivalent to dirname(__DIR__) in PHP)
# __file__ is .../main/demos-client/demo.py
# current_dir is .../main/demos-client
# base_dir is .../main
current_dir = os.path.dirname(os.path.abspath(__file__))
base_dir = os.path.dirname(current_dir)

# 2. Add 'clients' folder to the system path so we can import our API
sys.path.append(os.path.join(base_dir, 'clients'))

# Now we can import the client creator from api.py (assuming you named it tlite_api.py)
from clients.api import kvdb_client

# 3. Define Certificate paths relative to base_dir
certs = {
    'ca': os.path.join(base_dir, 'certs', 'ca.crt'),
    'cert': os.path.join(base_dir, 'certs', 'client.crt'),
    'key': os.path.join(base_dir, 'certs', 'client.key')
}



try:
    # 4. Initialize the Client
    db = kvdb_client(
        host='localhost', 
        port=9999, 
        ca_cert=certs['ca'], 
        client_cert=certs['cert'], 
        client_key=certs['key']
    )
    
    print("🚀 Python Demo Started (Path Resolved)\n")

    # --- Full Command Implementation Demo ---
    
    # Context Management
    print("USE TABLE:", db['use']('python_demo'))
    print("ALL TABLES:", db['tables']())

    # Key-Value Operations
    # Note: Our API handles dictionary to JSON string conversion automatically
    user_data = {"name": "Ganesh", "role": "developer", "active": True}
    print("SET KEY:", db['set']('user_101', user_data))
    
    res = db['get']('user_101')
    print("GET KEY:", res['data']['value'])

    # Search Logic
    print("SEARCH 'developer':", db['search']('developer'))
    print("SEARCH KEY 'user_':", db['search_key']('user_'))

    # Pagination Logic
    print("LIST (Limit 2):")
    list_res = db['list'](2)
    print(json.dumps(list_res, indent=2))
    
    if list_res.get('pagination', {}).get('hasMore'):
        print("NEXT BATCH:", db['next']())

    # Admin/SQL Logic
    print("SQL QUERY:", db['sql']("SELECT count(*) as count FROM python_demo"))
    print("PERSIST TO DISK:", db['dump']())

    # Cleanup
    print("DELETE KEY:", db['delete']('user_101'))
    print("CLEAR TABLE:", db['clear']())
    print("DROP TABLE:", db['drop']('python_demo'))

    db['close']()
    print("\n✅ Python Demo Complete.")

except Exception as e:
    print(f"❌ Error: {e}")