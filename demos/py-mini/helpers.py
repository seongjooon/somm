def total(values):
    return sum(values)


def average(values):
    return total(values) / len(values) if values else 0


# TODO: Add an optional precision argument while preserving the default behavior.
def format_price(value):
    return f"${value:.2f}"
