/* Emacs style mode select   -*- C++ -*-
 *-----------------------------------------------------------------------------
 *
 *
 *  PrBoom: a Doom port merged with LxDoom and LSDLDoom
 *  based on BOOM, a modified and improved DOOM engine
 *  Copyright (C) 1999 by
 *  id Software, Chi Hoang, Lee Killough, Jim Flynn, Rand Phares, Ty Halderman
 *  Copyright (C) 1999-2000 by
 *  Jess Haas, Nicolas Kalkhof, Colin Phipps, Florian Schulze
 *  Copyright 2005, 2006 by
 *  Florian Schulze, Colin Phipps, Neil Stevens, Andrey Budko
 *
 *  This program is free software; you can redistribute it and/or
 *  modify it under the terms of the GNU General Public License
 *  as published by the Free Software Foundation; either version 2
 *  of the License, or (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA
 *  02111-1307, USA.
 *
 * DESCRIPTION:
 *      Status bar code.
 *      Does the face/direction indicator animatin.
 *      Does palette indicators as well (red pain/berserk, bright pickup)
 *
 *-----------------------------------------------------------------------------*/


// Face expressions from pinned GBADoom/PrBoom. Explicitly reset on ST_Start.
static int faceAttackDelay,facePriority;
static int ST_calcPainOffset(void)
{
  static int lastcalc;
  static int oldhealth = -1;
  int health = _g->player.health > 100 ? 100 : _g->player.health;

  if (health != oldhealth)
    {
      lastcalc = ST_FACESTRIDE * (((100 - health) * ST_NUMPAINFACES) / 101);
      oldhealth = health;
    }
  return lastcalc;
}

//
// This is a not-very-pretty routine which handles
//  the face states and their timing.
// the precedence of expressions is:
//  dead > evil grin > turned head > straight ahead
//

static void ST_updateFaceWidget(void)
{
    int         i;
	angle_t     badguyangle;
	angle_t     diffang;


    boolean     doevilgrin;

    if (facePriority < 10)
    {
        // dead
        if (_g->player.health <= 0)
        {
            facePriority = 9;
            _g->st_faceindex = ST_DEADFACE;
            _g->st_facecount = 1;
        }
    }

    if (facePriority < 9)
    {
        if (_g->player.bonuscount)
        {
            // picking up bonus
            doevilgrin = false;

            for (i=0;i<NUMWEAPONS;i++)
            {
                if (_g->oldweaponsowned[i] != _g->player.weaponowned[i])
                {
                    doevilgrin = true;
                    _g->oldweaponsowned[i] = _g->player.weaponowned[i];
                }
            }
            if (doevilgrin)
            {
                // evil grin if just picked up weapon
                facePriority = 8;
                _g->st_facecount = ST_EVILGRINCOUNT;
                _g->st_faceindex = ST_calcPainOffset() + ST_EVILGRINOFFSET;
            }
        }

    }

	//Restore the face looking at enemies direction in this SVN... Cause it's handy! ~Kippykip
	if (facePriority < 8)
    {
        if (_g->player.damagecount && _g->player.attacker && _g->player.attacker != _g->player.mo)
		{
			// being attacked
			facePriority = 7;

			// haleyjd 10/12/03: classic DOOM problem of missing OUCH face
			// was due to inversion of this test:
			// if(plyr->health - st_oldhealth > ST_MUCHPAIN)
            if(_g->st_oldhealth - _g->player.health > ST_MUCHPAIN)
			{
				_g->st_facecount = ST_TURNCOUNT;
				_g->st_faceindex = ST_calcPainOffset() + ST_OUCHOFFSET;
			}
			else
			{
                badguyangle = R_PointToAngle2(_g->player.mo->x,
                _g->player.mo->y,
                _g->player.attacker->x,
                _g->player.attacker->y);

                if (badguyangle > _g->player.mo->angle)
				{
					// whether right or left
                    diffang = badguyangle - _g->player.mo->angle;
					i = diffang > ANG180;
				}
				else
				{
					// whether left or right
                    diffang = _g->player.mo->angle - badguyangle;
					i = diffang <= ANG180;
				} // confusing, aint it?


				_g->st_facecount = ST_TURNCOUNT;
				_g->st_faceindex = ST_calcPainOffset();

				if (diffang < ANG45)
				{
					// head-on
					_g->st_faceindex += ST_RAMPAGEOFFSET;
				}
				else if (i)
				{
					// turn face right
					_g->st_faceindex += ST_TURNOFFSET;
				}
				else
				{
					// turn face left
					_g->st_faceindex += ST_TURNOFFSET+1;
				}
			}
		}
    }

    if (facePriority < 7)
    {
        if (_g->player.damagecount)
        {
            // haleyjd 10/12/03: classic DOOM problem of missing OUCH face
            // was due to inversion of this test:
            // if(plyr->health - st_oldhealth > ST_MUCHPAIN)
            if(_g->st_oldhealth - _g->player.health > ST_MUCHPAIN)
            {
                facePriority = 7;
                _g->st_facecount = ST_TURNCOUNT;
                _g->st_faceindex = ST_calcPainOffset() + ST_OUCHOFFSET;
            }
            else
            {
                facePriority = 6;
                _g->st_facecount = ST_TURNCOUNT;
                _g->st_faceindex = ST_calcPainOffset() + ST_RAMPAGEOFFSET;
            }

        }
    }

    if (facePriority < 6)
    {
        // rapid firing
        if (_g->player.attackdown)
        {
            if (faceAttackDelay==-1)
                faceAttackDelay = ST_RAMPAGEDELAY;
            else if (!--faceAttackDelay)
            {
                facePriority = 5;
                _g->st_faceindex = ST_calcPainOffset() + ST_RAMPAGEOFFSET;
                _g->st_facecount = 1;
                faceAttackDelay = 1;
            }
        }
        else
            faceAttackDelay = -1;

    }

    if (facePriority < 5)
    {
        // invulnerability
        if ((_g->player.cheats & CF_GODMODE)
                || _g->player.powers[pw_invulnerability])
        {
            facePriority = 4;

            _g->st_faceindex = ST_GODFACE;
            _g->st_facecount = 1;

        }

    }

    // look left or look right if the facecount has timed out
    if (!_g->st_facecount)
    {
        _g->st_faceindex = ST_calcPainOffset() + (_g->st_randomnumber % 3);
        _g->st_facecount = ST_STRAIGHTFACECOUNT;
        facePriority = 0;
    }

    _g->st_facecount--;

}
