"""initial schema"""
from alembic import op

revision = "001"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, email VARCHAR(255) UNIQUE NOT NULL, hashed_password VARCHAR(255) NOT NULL, created_at TIMESTAMP DEFAULT NOW())")

def downgrade():
    op.execute("DROP TABLE IF EXISTS users")
