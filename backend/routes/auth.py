from fastapi import APIRouter

router = APIRouter()

@router.post("/register")
async def register():
    return {"message": "register placeholder"}

@router.post("/login")
async def login():
    return {"message": "login placeholder"}
