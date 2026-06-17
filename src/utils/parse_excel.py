import sys
import os
import json
import re
from datetime import datetime
import openpyxl

def clean_brand_name(name):
    if not name:
        return ""
    # Remove leading/trailing spaces
    name = name.strip()
    # Strip suffix 'Brand', 'Brands', '.Brands' case-insensitively
    cleaned = re.sub(r'\s*\.?Brands?\s*$', '', name, flags=re.IGNORECASE)
    return cleaned.strip()

def parse_expiry_date(val):
    if not val:
        return None
    if isinstance(val, datetime):
        return val.strftime('%Y-%m')
    
    s = str(val).strip()
    if not s:
        return None
    
    # Clean up known typos like 82028 -> 2028, 82027 -> 2027
    s = re.sub(r'8202(\d)', r'202\1', s)
    
    # Match YYYY-MM
    m = re.match(r'^(\d{4})[-/](\d{1,2})', s)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}"
        
    # Match MM-YYYY or MM/YYYY
    m = re.match(r'^(\d{1,2})[-/](\d{4})', s)
    if m:
        return f"{m.group(2)}-{int(m.group(1)):02d}"
        
    # Match MM/YY or MM-YY
    m = re.match(r'^(\d{1,2})[-/](\d{2})$', s)
    if m:
        return f"20{m.group(2)}-{int(m.group(1)):02d}"
        
    return s

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        sys.exit(1)
        
    file_path = sys.argv[1]
    if not os.path.exists(file_path):
        print(json.dumps({"error": f"File not found: {file_path}"}))
        sys.exit(1)
        
    try:
        wb = openpyxl.load_workbook(file_path, data_only=True)
        sheet = wb.active
        
        products = []
        current_brand = None
        is_diffrent_brands = False
        
        # Iterate over all rows starting from row 2 (skipping the main title/header)
        for row_idx, row in enumerate(sheet.iter_rows(min_row=2, values_only=True), start=2):
            col_a = row[0]
            col_b = row[1]
            col_f = row[5]
            col_g = row[6]
            
            # Check if this is a brand header row
            # Brand headers have Col A populated with the brand name, and other columns are empty (None)
            is_brand_header = col_a and not col_b and col_f is None and col_g is None
            
            if is_brand_header:
                header_val = str(col_a).strip()
                if re.match(r'^diff?rent\.?brands?$', header_val, re.IGNORECASE):
                    is_diffrent_brands = True
                    current_brand = None
                else:
                    is_diffrent_brands = False
                    current_brand = clean_brand_name(header_val)
                continue
            
            # If we have a product title (Col B) and price (Col G)
            if col_b:
                title = str(col_b).strip()
                price = None
                try:
                    if col_g is not None:
                        price = float(col_g)
                except ValueError:
                    pass
                
                # Expiry date
                expiry_str = parse_expiry_date(col_f)
                
                # Resolve brand
                brand_name = current_brand
                if is_diffrent_brands:
                    # Extract brand from the first part of title before the first comma
                    brand_part = title.split(',')[0].strip()
                    # Fallback if there is no comma or first segment is too long
                    if len(brand_part) > 30 or (' ' in brand_part and len(brand_part.split()) > 3):
                        words = title.split()
                        if len(words) > 1 and words[1].lower() in ['labs', 'lab', 'nutrition', 'herbs', 'plus', 'way']:
                            brand_name = f"{words[0]} {words[1]}"
                        elif words:
                            brand_name = words[0]
                        else:
                            brand_name = "Other"
                    else:
                        brand_name = brand_part
                
                if not brand_name:
                    brand_name = "Other"
                    
                products.append({
                    "title": title,
                    "brand": brand_name,
                    "expiryDate": expiry_str,
                    "price": price
                })
                
        print(json.dumps(products, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == '__main__':
    main()
