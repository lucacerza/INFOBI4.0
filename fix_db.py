import sqlite3
conn = sqlite3.connect('data/infobi.db')
conn.execute("UPDATE connections SET database='cattaneo10' WHERE name='SERVER2023'")
conn.commit()
print("Database restored to 'cattaneo10'")
