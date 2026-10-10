"""Skill 包:导入即注册。"""
from . import audit_skills, buyer_conversion, industry_intelligence, market_localization, market_transcreation  # noqa: F401
from .registry import all_skills, get, register, run  # noqa: F401
