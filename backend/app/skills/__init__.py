"""Skill 包:导入即注册。"""
from . import industry_intelligence, market_localization, market_transcreation  # noqa: F401
from .registry import all_skills, get, register, run  # noqa: F401
