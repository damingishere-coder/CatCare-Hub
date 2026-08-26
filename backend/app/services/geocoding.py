import hashlib

from app.maps import GeocodeResult
from app.services.orders import geocode_address_region


GEOCODE_RULE_VERSION = "route-geocode-v2"


def normalized_geocode_address(value: str) -> str:
    return "".join(value.strip().casefold().split())


def geocode_fingerprint(provider_name: str, address: str) -> str:
    material = "|".join(
        (
            GEOCODE_RULE_VERSION,
            provider_name.strip().casefold(),
            normalized_geocode_address(address),
        )
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def geocode_result_matches_address(address: str, result: GeocodeResult) -> bool:
    expected_city, expected_district = geocode_address_region(address)
    actual_city = (result.city or "").strip()
    actual_district = (result.district or "").strip()

    if expected_city and expected_city not in {actual_city, actual_district}:
        return False
    if expected_district and expected_district != actual_district:
        return False
    return True
