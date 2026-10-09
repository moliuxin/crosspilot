"""Skill 包:导入即注册。"""
from . import industry_intelligence, market_localization  # noqa: F401
from .registry import all_skills, get, register, run  # noqa: F401
