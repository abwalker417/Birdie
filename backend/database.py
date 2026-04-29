from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from config import settings

engine = create_async_engine(settings.database_url, future=True, echo=False)
SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

async def get_db():
    async with SessionLocal() as session:
        yield session
