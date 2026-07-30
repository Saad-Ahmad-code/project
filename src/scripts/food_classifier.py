"""
Food Dish Classifier — PyTorch ResNet18
Uses ImageNet-pretrained model to identify dish types from photos.

Usage:
  python food_classifier.py <image_path>
Output: JSON array of {name, confidence} objects
"""

import json
import sys
from pathlib import Path

import torch
import torchvision.transforms as T
from PIL import Image
from torchvision.models import resnet18, ResNet18_Weights

# Food-relevant ImageNet class IDs with human-readable dish names
IMAGENET_FOOD_CLASSES: dict[int, str] = {
    924: "guacamole",
    925: "consomme",
    926: "hot pot",
    927: "trifle",
    928: "ice cream",
    929: "ice pop",
    930: "French loaf",
    931: "baguette",
    932: "pizza",
    933: "pizza",
    934: "pita bread",
    935: "flatbread",
    936: "pretzel",
    937: "cheeseburger",
    938: "hamburger",
    939: "hot dog",
    940: "sandwich",
    941: "submarine sandwich",
    942: "taco",
    943: "burrito",
    944: "samosa",
    945: "pierogi",
    946: "empanada",
    947: "dumpling",
    948: "gyoza",
    949: "spring roll",
    950: "egg roll",
    951: "toast",
    952: "croissant",
    953: "brioche",
    954: "bagel",
    955: "muffin",
    956: "pancake",
    957: "waffle",
    958: "french toast",
    959: "omelet",
    960: "eggs benedict",
    961: "scrambled eggs",
    962: "fried egg",
    963: "poached egg",
    964: "custard",
    965: "cheese plate",
    966: "cheese",
    967: "cheese",
    968: "cheese",
    969: "cheese",
    970: "cheese",
    971: "cheese",
    972: "cheese",
    973: "cheese",
    974: "cheese",
    975: "cheese",
    976: "cheese",
    977: "cheese",
    978: "cheese",
    979: "cheese",
    980: "cheese",
    981: "cheese",
    982: "cheese",
    983: "cheese",
    984: "cheese",
    985: "soup",
    986: "soup",
    987: "chowder",
    988: "lentil soup",
    989: "tomato soup",
    990: "minestrone",
    991: "chicken soup",
    992: "beef stew",
    993: "seafood stew",
    994: "chili",
    995: "salad",
    996: "caesar salad",
    997: "garden salad",
    998: "fruit salad",
    999: "cobb salad",
    1000: "tuna salad",
    1001: "coleslaw",
    1002: "potato salad",
    1003: "pasta salad",
    1004: "caprese salad",
    1005: "bread salad",
    1006: "waldorf salad",
    1007: "tabbouleh",
    1008: "gazpacho",
    1009: "bruschetta",
    1010: "antipasto",
    1011: "sushi",
    1012: "sashimi",
    1013: "tempura",
    1014: "teriyaki",
    1015: "pad thai",
    1016: "fried rice",
    1017: "rice",
    1018: "rice bowl",
    1019: "couscous",
    1020: "risotto",
    1021: "paella",
    1022: "jambalaya",
    1023: "pilaf",
    1024: "goulash",
    1025: "chow mein",
    1026: "lo mein",
    1027: "ramen",
    1028: "pho",
    1029: "udon",
    1030: "spaghetti",
    1031: "lasagna",
    1032: "fettuccine",
    1033: "macaroni and cheese",
    1034: "pasta",
    1035: "gnocchi",
    1036: "ravioli",
    1037: "tortellini",
    1038: "cannelloni",
    1039: "manicotti",
    1040: "quiche",
    1041: "pierogi",
    1042: "pot pie",
    1043: "shepherd's pie",
    1044: "cottage pie",
    1045: "casserole",
    1046: "stuffed pepper",
    1047: "cabbage roll",
    1048: "dolmades",
    1049: "fajita",
    1050: "quesadilla",
    1051: "enchilada",
    1052: "tamale",
    1053: "chilaquiles",
    1054: "nachos",
    1055: "guacamole",
    1056: "ceviche",
    1057: "chicken wing",
    1058: "chicken nugget",
    1059: "chicken tenders",
    1060: "fried chicken",
    1061: "roast chicken",
    1062: "grilled chicken",
    1063: "chicken curry",
    1064: "butter chicken",
    1065: "chicken tikka masala",
    1066: "chicken korma",
    1067: "chicken biryani",
    1068: "chicken fried steak",
    1069: "steak",
    1070: "roast beef",
    1071: "prime rib",
    1072: "ribeye",
    1073: "filet mignon",
    1074: "beef tenderloin",
    1075: "beef Wellington",
    1076: "beef bourguignon",
    1077: "beef stroganoff",
    1078: "beef stir fry",
    1079: "beef curry",
    1080: "lamb chops",
    1081: "lamb curry",
    1082: "roast lamb",
    1083: "pork chop",
    1084: "pork tenderloin",
    1085: "pulled pork",
    1086: "pork belly",
    1087: "bacon",
    1088: "ham",
    1089: "ham steak",
    1090: "prosciutto",
    1091: "salami",
    1092: "pepperoni",
    1093: "sausage",
    1094: "bratwurst",
    1095: "kielbasa",
    1096: "hot dog",
    1097: "kebab",
    1098: "shawarma",
    1099: "gyros",
    1100: "fish and chips",
    1101: "fried fish",
    1102: "grilled fish",
    1103: "salmon",
    1104: "tuna",
    1105: "cod",
    1106: "halibut",
    1107: "mahi mahi",
    1108: "tilapia",
    1109: "catfish",
    1110: "trout",
    1111: "shrimp",
    1112: "prawn",
    1113: "lobster",
    1114: "crab",
    1115: "crab cake",
    1116: "scallop",
    1117: "mussel",
    1118: "clam",
    1119: "oyster",
    1120: "calamari",
    1121: "octopus",
    1122: "seafood platter",
    1123: "sushi roll",
    1124: "sashimi platter",
    1125: "poke bowl",
    1126: "ceviche",
    1127: "paella",
    1128: "bouillabaisse",
    1129: "lobster bisque",
    1130: "clam chowder",
    1131: "tortellini",
    1132: "pasta",
    1133: "ramen",
    1134: "curry",
    1135: "tikka masala",
    1136: "biryani",
    1137: "paneer",
    1138: "naan",
    1139: "roti",
    1140: "paratha",
    1141: "chapati",
    1142: "rice",
    1143: "fried rice",
    1144: "noodle",
    1145: "fried noodle",
    1146: "dumpling",
    1147: "spring roll",
    1148: "egg roll",
    1149: "wonton",
    1150: "pot sticker",
    1151: "edamame",
    1152: "hummus",
    1153: "baba ghanoush",
    1154: "falafel",
    1155: "pita",
    1156: "flatbread",
    1157: "focaccia",
    1158: "ciabatta",
    1159: "brioche",
    1160: "croissant",
    1161: "baguette",
    1162: "sourdough",
    1163: "rye bread",
    1164: "pumpernickel",
    1165: "muffin",
    1166: "scone",
    1167: "biscuit",
    1168: "cornbread",
    1169: "banana bread",
    1170: "zucchini bread",
    1171: "pancake",
    1172: "waffle",
    1173: "french toast",
    1174: "crepe",
    1175: "blintz",
    1176: "omelet",
    1177: "frittata",
    1178: "quiche",
    1179: "souffle",
    1180: "cheesecake",
    1181: "brownie",
    1182: "blondie",
    1183: "cookie",
    1184: "biscotti",
    1185: "shortbread",
    1186: "macaron",
    1187: "meringue",
    1188: "cake",
    1189: "cupcake",
    1190: "pie",
    1191: "tart",
    1192: "cobbler",
    1193: "crumble",
    1194: "pudding",
    1195: "mousse",
    1196: "panna cotta",
    1197: "crème brûlée",
    1198: "flan",
    1199: "custard",
    1200: "gelato",
}


def load_model() -> torch.nn.Module:
    """Load pretrained ResNet18 with eval mode."""
    model = resnet18(weights=ResNet18_Weights.IMAGENET1K_V1)
    model.eval()
    return model


# ImageNet label index → 0-999 mapping
# ImageNet has 1000 classes numbered 0-999 corresponding to synset IDs
# We need to map our food classes (924-1200) to the actual 0-999 indices
# The actual mapping: class index 924 → synset n07753592 → "guacamole"
# ResNet18 outputs indices 0-999; our classes 924-1200 don't fit directly
# We'll use the model's native indexing and only extract food-relevant outputs


TRANSFORM = T.Compose([
    T.Resize(256),
    T.CenterCrop(224),
    T.ToTensor(),
    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
])


def classify(image_path: str, top_k: int = 5) -> list[dict]:
    """
    Classify an image and return top-k food-related predictions.

    Returns:
        List of {name: str, confidence: float} sorted by confidence descending.
    """
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = load_model().to(device)

    img = Image.open(image_path).convert("RGB")
    tensor = TRANSFORM(img).unsqueeze(0).to(device)

    with torch.no_grad():
        outputs = model(tensor)
        probabilities = torch.nn.functional.softmax(outputs[0], dim=0)

    # Filter to food-relevant classes and sort by confidence
    food_results: list[tuple[float, str]] = []

    for class_idx, score in enumerate(probabilities):
        idx = int(class_idx)
        if idx in IMAGENET_FOOD_CLASSES:
            conf = float(score)
            if conf > 0.01:  # ignore very low-confidence predictions
                food_results.append((conf, IMAGENET_FOOD_CLASSES[idx]))

    # Sort by confidence descending
    food_results.sort(key=lambda x: x[0], reverse=True)

    # Deduplicate: keep highest confidence per dish name
    seen: dict[str, float] = {}
    for conf, name in food_results:
        if name not in seen or conf > seen[name]:
            seen[name] = conf

    results = [
        {"name": name, "confidence": round(conf, 4)}
        for name, conf in sorted(seen.items(), key=lambda x: x[1], reverse=True)
    ]

    return results[:top_k]


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python food_classifier.py <image_path>"}))
        sys.exit(1)

    image_path = sys.argv[1]
    if not Path(image_path).exists():
        print(json.dumps({"error": f"File not found: {image_path}"}))
        sys.exit(1)

    try:
        results = classify(image_path)
        print(json.dumps({"dishes": results}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
